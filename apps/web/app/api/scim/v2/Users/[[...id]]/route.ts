import { isOidcMode } from "@cap/database/auth/domain-utils";
import { NextResponse } from "next/server";
import {
	deprovisionUser,
	emailFromPendingId,
	findScimUser,
	isScimAuthorized,
	isScimEnabled,
	parseActiveFromPatch,
	pendingIdForEmail,
	reprovisionUser,
	SCIM_ERROR_SCHEMA,
	SCIM_LIST_SCHEMA,
	scimUserResource,
} from "@/lib/scim";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id?: string[] }> };

const scimJson = (body: unknown, status = 200) =>
	NextResponse.json(body, {
		status,
		headers: { "content-type": "application/scim+json" },
	});

const scimError = (status: number, detail: string) =>
	scimJson(
		{ schemas: [SCIM_ERROR_SCHEMA], status: String(status), detail },
		status,
	);

const gate = (request: Request) => {
	if (!isOidcMode() || !isScimEnabled()) {
		return new NextResponse(null, { status: 404 });
	}
	if (!isScimAuthorized(request)) return scimError(401, "Unauthorized");
	return null;
};

const toResource = (
	user: NonNullable<Awaited<ReturnType<typeof findScimUser>>>,
) =>
	scimUserResource({
		id: user.id,
		email: user.email,
		name: user.name,
		lastName: user.lastName,
		active: user.disabledAt === null,
	});

const readBody = async (request: Request) => {
	try {
		return (await request.json()) as unknown;
	} catch {
		return null;
	}
};

const emailFromBody = (body: unknown) => {
	if (!body || typeof body !== "object") return null;
	const { userName, emails } = body as {
		userName?: unknown;
		emails?: unknown;
	};
	if (typeof userName === "string" && userName.includes("@"))
		return userName.trim().toLowerCase();
	if (Array.isArray(emails)) {
		const primary = emails.find(
			(entry) => entry && typeof entry === "object" && "value" in entry,
		) as { value?: unknown } | undefined;
		if (typeof primary?.value === "string")
			return primary.value.trim().toLowerCase();
	}
	return null;
};

export async function GET(request: Request, context: Context) {
	const denied = gate(request);
	if (denied) return denied;
	const { id } = await context.params;

	if (id?.[0]) {
		const user = await findScimUser({ id: id[0] });
		if (user) return scimJson(toResource(user));
		const email = emailFromPendingId(id[0]);
		if (!email) return scimError(404, "User not found");
		return scimJson(scimUserResource({ id: id[0], email, active: true }));
	}

	const filter = new URL(request.url).searchParams.get("filter") ?? "";
	const match = filter.match(/^userName\s+eq\s+"([^"]+)"$/i);
	const user = match?.[1] ? await findScimUser({ email: match[1] }) : null;
	return scimJson({
		schemas: [SCIM_LIST_SCHEMA],
		totalResults: user ? 1 : 0,
		startIndex: 1,
		itemsPerPage: user ? 1 : 0,
		Resources: user ? [toResource(user)] : [],
	});
}

export async function POST(request: Request) {
	const denied = gate(request);
	if (denied) return denied;
	const email = emailFromBody(await readBody(request));
	if (!email) return scimError(400, "userName must be an email address");
	const user = await findScimUser({ email });
	if (user) return scimJson(toResource(user), 409);
	return scimJson(
		scimUserResource({ id: pendingIdForEmail(email), email, active: true }),
		201,
	);
}

async function applyActive(id: string, active: boolean) {
	const user = await findScimUser({ id });
	if (!user) return null;
	if (active) await reprovisionUser(user.id);
	else await deprovisionUser(user.id);
	return findScimUser({ id: user.id });
}

async function update(request: Request, context: Context) {
	const denied = gate(request);
	if (denied) return denied;
	const { id } = await context.params;
	if (!id?.[0]) return scimError(400, "User id required");
	const body = await readBody(request);
	const active =
		request.method === "PUT"
			? parseActiveFromPatch({
					Operations: [
						{
							path: "active",
							value: (body as { active?: unknown } | null)?.active,
						},
					],
				})
			: parseActiveFromPatch(body);
	if (active === null) {
		const user = await findScimUser({ id: id[0] });
		if (user) return scimJson(toResource(user));
		const email = emailFromPendingId(id[0]);
		return email
			? scimJson(scimUserResource({ id: id[0], email, active: true }))
			: scimError(404, "User not found");
	}
	const user = await applyActive(id[0], active);
	if (user) return scimJson(toResource(user));
	const email = emailFromPendingId(id[0]);
	return email
		? scimJson(scimUserResource({ id: id[0], email, active }))
		: scimError(404, "User not found");
}

export const PATCH = update;
export const PUT = update;

export async function DELETE(request: Request, context: Context) {
	const denied = gate(request);
	if (denied) return denied;
	const { id } = await context.params;
	if (!id?.[0]) return scimError(400, "User id required");
	const user = await findScimUser({ id: id[0] });
	if (user) await deprovisionUser(user.id);
	return new NextResponse(null, { status: 204 });
}
