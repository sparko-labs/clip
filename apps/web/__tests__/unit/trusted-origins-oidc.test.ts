import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
	AUTH_MODE: "legacy" as "legacy" | "oidc",
	WEB_URL: "https://recorder.company.example",
}));

vi.mock("@cap/env", () => ({
	serverEnv: () => env,
	buildEnv: { NEXT_PUBLIC_WEB_URL: "https://recorder.company.example" },
}));

import { getHeaders } from "@/utils/helpers";

describe("credentialed cross-origin trust", () => {
	beforeEach(() => {
		env.AUTH_MODE = "legacy";
	});

	it("trusts cap.so hosts in legacy mode", () => {
		expect(getHeaders("https://app.cap.so")).toMatchObject({
			"Access-Control-Allow-Origin": "https://app.cap.so",
			"Access-Control-Allow-Credentials": "true",
		});
	});

	it.each(["https://cap.so", "https://app.cap.so", "https://cap.link"])(
		"never reflects %s with credentials in oidc mode",
		(origin) => {
			env.AUTH_MODE = "oidc";
			const headers = getHeaders(origin);
			expect(headers["Access-Control-Allow-Origin"]).toBe("*");
			expect(headers).not.toHaveProperty("Access-Control-Allow-Credentials");
		},
	);

	it("still trusts the configured web origin in oidc mode", () => {
		env.AUTH_MODE = "oidc";
		expect(getHeaders("https://recorder.company.example")).toMatchObject({
			"Access-Control-Allow-Origin": "https://recorder.company.example",
			"Access-Control-Allow-Credentials": "true",
		});
	});
});
