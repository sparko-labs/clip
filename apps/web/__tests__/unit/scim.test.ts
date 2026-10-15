import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	calls: [] as string[],
	transaction: vi.fn(),
	userRows: [] as Array<{
		id: string;
		email: string;
		name: string | null;
		lastName: string | null;
		disabledAt: Date | null;
	}>,
}));

const env = vi.hoisted(() => ({
	AUTH_MODE: "oidc" as "oidc" | "legacy",
	SCIM_BEARER_TOKEN: "scim-secret-token" as string | undefined,
	OIDC_ALLOWED_EMAIL_DOMAINS: "company.example",
	CAP_BLOCKED_SIGNUP_DOMAINS: undefined,
}));

function recorder(name: string, result: unknown = []): unknown {
	const target = () => undefined;
	return new Proxy(target, {
		get(_t, prop) {
			if (prop === "then") {
				return (resolve: (value: unknown) => unknown) => resolve(result);
			}
			return (..._args: unknown[]) => {
				state.calls.push(`${name}.${String(prop)}`);
				return recorder(name, result);
			};
		},
		apply() {
			return undefined;
		},
	});
}

vi.mock("@cap/env", () => ({ serverEnv: () => env }));
vi.mock("@cap/database", () => ({
	db: () => ({
		select: () => recorder("select", state.userRows),
		insert: () => recorder("insert"),
		update: () => recorder("update"),
		delete: () => recorder("delete"),
		transaction: async (fn: (tx: unknown) => Promise<void>) => {
			state.transaction();
			await fn({
				insert: () => recorder("tx.insert"),
				update: () => recorder("tx.update"),
				delete: () => recorder("tx.delete"),
				select: () => recorder("tx.select", []),
			});
		},
	}),
}));

import {
	emailFromPendingId,
	isScimAuthorized,
	parseActiveFromPatch,
	pendingIdForEmail,
} from "@/lib/scim";

const auth = { authorization: "Bearer scim-secret-token" };

const request = (
	method: string,
	path = "",
	init: { headers?: Record<string, string>; body?: string } = {},
) =>
	new NextRequest(`https://cap.example/api/scim/v2/Users${path}`, {
		method,
		body: init.body,
		headers: { "content-type": "application/scim+json", ...init.headers },
	});

const ctx = (id?: string) => ({
	params: Promise.resolve({ id: id ? [id] : undefined }),
});

describe("scim helpers", () => {
	beforeEach(() => {
		env.SCIM_BEARER_TOKEN = "scim-secret-token";
	});

	it("authorizes only the configured bearer token", () => {
		expect(isScimAuthorized(request("GET", "", { headers: auth }))).toBe(true);
		expect(
			isScimAuthorized(
				request("GET", "", { headers: { authorization: "Bearer nope" } }),
			),
		).toBe(false);
		expect(isScimAuthorized(request("GET"))).toBe(false);
	});

	it("never authorizes when no token is configured", () => {
		env.SCIM_BEARER_TOKEN = undefined;
		expect(isScimAuthorized(request("GET", "", { headers: auth }))).toBe(false);
		expect(
			isScimAuthorized(
				request("GET", "", { headers: { authorization: "Bearer " } }),
			),
		).toBe(false);
	});

	it("round-trips pending ids", () => {
		const id = pendingIdForEmail("Alex@Company.Example");
		expect(emailFromPendingId(id)).toBe("alex@company.example");
		expect(emailFromPendingId("abc123")).toBeNull();
	});

	it.each([
		[{ Operations: [{ op: "replace", path: "active", value: false }] }, false],
		[
			{ Operations: [{ op: "Replace", path: "active", value: "False" }] },
			false,
		],
		[{ Operations: [{ op: "replace", value: { active: false } }] }, false],
		[{ Operations: [{ op: "replace", path: "active", value: true }] }, true],
		[{ Operations: [{ op: "replace", path: "active", value: "True" }] }, true],
		[
			{ Operations: [{ op: "replace", path: "displayName", value: "x" }] },
			null,
		],
		[{}, null],
		[null, null],
	])("parses active from %j", (body, expected) => {
		expect(parseActiveFromPatch(body)).toBe(expected);
	});
});

describe("scim route", () => {
	beforeEach(() => {
		env.AUTH_MODE = "oidc";
		env.SCIM_BEARER_TOKEN = "scim-secret-token";
		state.calls = [];
		state.transaction.mockReset();
		state.userRows = [
			{
				id: "user-1",
				email: "alex@company.example",
				name: "Alex",
				lastName: null,
				disabledAt: null,
			},
		];
	});

	it("is invisible outside oidc mode", async () => {
		env.AUTH_MODE = "legacy";
		const { GET } = await import("@/app/api/scim/v2/Users/[[...id]]/route");
		const response = await GET(request("GET", "", { headers: auth }), ctx());
		expect(response.status).toBe(404);
	});

	it("is invisible when no token is configured", async () => {
		env.SCIM_BEARER_TOKEN = undefined;
		const { GET } = await import("@/app/api/scim/v2/Users/[[...id]]/route");
		const response = await GET(request("GET", "", { headers: auth }), ctx());
		expect(response.status).toBe(404);
	});

	it("rejects a wrong token", async () => {
		const { PATCH, DELETE } = await import(
			"@/app/api/scim/v2/Users/[[...id]]/route"
		);
		const bad = { authorization: "Bearer wrong" };
		expect(
			(
				await PATCH(
					request("PATCH", "/user-1", { headers: bad }),
					ctx("user-1"),
				)
			).status,
		).toBe(401);
		expect(
			(
				await DELETE(
					request("DELETE", "/user-1", { headers: bad }),
					ctx("user-1"),
				)
			).status,
		).toBe(401);
		expect(state.transaction).not.toHaveBeenCalled();
	});

	it("revokes every credential when a user is deactivated", async () => {
		const { PATCH } = await import("@/app/api/scim/v2/Users/[[...id]]/route");
		const response = await PATCH(
			request("PATCH", "/user-1", {
				headers: auth,
				body: JSON.stringify({
					Operations: [{ op: "replace", path: "active", value: false }],
				}),
			}),
			ctx("user-1"),
		);
		expect(response.status).toBe(200);
		expect(state.transaction).toHaveBeenCalledTimes(1);
		expect(state.calls).toEqual(
			expect.arrayContaining([
				"tx.insert.values",
				"tx.insert.onDuplicateKeyUpdate",
				"tx.update.set",
				"tx.delete.where",
			]),
		);
		expect(state.calls.filter((c) => c === "tx.delete.where")).toHaveLength(3);
	});

	it("re-enables a user without touching credentials", async () => {
		const { PATCH } = await import("@/app/api/scim/v2/Users/[[...id]]/route");
		const response = await PATCH(
			request("PATCH", "/user-1", {
				headers: auth,
				body: JSON.stringify({
					Operations: [{ op: "replace", path: "active", value: true }],
				}),
			}),
			ctx("user-1"),
		);
		expect(response.status).toBe(200);
		expect(state.transaction).not.toHaveBeenCalled();
		expect(state.calls).toContain("delete.where");
	});

	it("deactivates on DELETE and answers 204", async () => {
		const { DELETE } = await import("@/app/api/scim/v2/Users/[[...id]]/route");
		const response = await DELETE(
			request("DELETE", "/user-1", { headers: auth }),
			ctx("user-1"),
		);
		expect(response.status).toBe(204);
		expect(state.transaction).toHaveBeenCalledTimes(1);
	});

	it("answers 204 when deleting an unknown user", async () => {
		state.userRows = [];
		const { DELETE } = await import("@/app/api/scim/v2/Users/[[...id]]/route");
		const response = await DELETE(
			request("DELETE", "/ghost", { headers: auth }),
			ctx("ghost"),
		);
		expect(response.status).toBe(204);
		expect(state.transaction).not.toHaveBeenCalled();
	});

	it("reports a known user as existing on create", async () => {
		const { POST } = await import("@/app/api/scim/v2/Users/[[...id]]/route");
		const response = await POST(
			request("POST", "", {
				headers: auth,
				body: JSON.stringify({ userName: "alex@company.example" }),
			}),
		);
		expect(response.status).toBe(409);
	});

	it("acknowledges a new user without creating a row", async () => {
		state.userRows = [];
		const { POST } = await import("@/app/api/scim/v2/Users/[[...id]]/route");
		const response = await POST(
			request("POST", "", {
				headers: auth,
				body: JSON.stringify({ userName: "new@company.example" }),
			}),
		);
		expect(response.status).toBe(201);
		const body = (await response.json()) as { id: string; active: boolean };
		expect(emailFromPendingId(body.id)).toBe("new@company.example");
		expect(body.active).toBe(true);
		expect(state.calls.filter((c) => c.startsWith("insert"))).toHaveLength(0);
	});
});
