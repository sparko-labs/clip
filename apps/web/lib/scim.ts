import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@cap/database";
import { forkUserAccess } from "@cap/database/fork/schema";
import {
	agentApiAuthorizationCodes,
	agentApiKeys,
	authApiKeys,
	developerApiKeys,
	developerApps,
	mcpOAuthCodes,
	mcpOAuthTokens,
	users,
} from "@cap/database/schema";
import { serverEnv } from "@cap/env";
import { User } from "@cap/web-domain";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_LIST_SCHEMA =
	"urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

const PENDING_ID_PREFIX = "e_";

const digest = (value: string) => createHash("sha256").update(value).digest();

export function isScimEnabled() {
	return Boolean(serverEnv().SCIM_BEARER_TOKEN);
}

export function isScimAuthorized(request: Request) {
	const expected = serverEnv().SCIM_BEARER_TOKEN;
	if (!expected) return false;
	const header = request.headers.get("authorization") ?? "";
	const match = header.match(/^Bearer (.+)$/i);
	if (!match?.[1]) return false;
	return timingSafeEqual(digest(match[1]), digest(expected));
}

export function pendingIdForEmail(email: string) {
	return `${PENDING_ID_PREFIX}${Buffer.from(email.toLowerCase()).toString("base64url")}`;
}

export function emailFromPendingId(id: string) {
	if (!id.startsWith(PENDING_ID_PREFIX)) return null;
	return Buffer.from(id.slice(PENDING_ID_PREFIX.length), "base64url")
		.toString("utf8")
		.toLowerCase();
}

export async function findScimUser(idOrEmail: { id?: string; email?: string }) {
	const email =
		idOrEmail.email?.toLowerCase() ??
		(idOrEmail.id ? emailFromPendingId(idOrEmail.id) : null);
	const [row] = await db()
		.select({
			id: users.id,
			email: users.email,
			name: users.name,
			lastName: users.lastName,
			disabledAt: forkUserAccess.disabledAt,
		})
		.from(users)
		.leftJoin(forkUserAccess, eq(forkUserAccess.userId, users.id))
		.where(
			email
				? eq(users.email, email)
				: eq(users.id, User.UserId.make(idOrEmail.id ?? "")),
		)
		.limit(1);
	return row ?? null;
}

export function scimUserResource(user: {
	id: string;
	email: string;
	name?: string | null;
	lastName?: string | null;
	active: boolean;
}) {
	return {
		schemas: [SCIM_USER_SCHEMA],
		id: user.id,
		userName: user.email,
		name: {
			givenName: user.name ?? "",
			familyName: user.lastName ?? "",
			formatted: [user.name, user.lastName].filter(Boolean).join(" "),
		},
		emails: [{ value: user.email, primary: true }],
		active: user.active,
		meta: { resourceType: "User" },
	};
}

export async function deprovisionUser(userId: User.UserId) {
	const now = new Date();
	await db().transaction(async (tx) => {
		await tx
			.insert(forkUserAccess)
			.values({ userId, disabledAt: now })
			.onDuplicateKeyUpdate({ set: { disabledAt: now } });
		await tx
			.update(users)
			.set({ authSessionVersion: sql`${users.authSessionVersion} + 1` })
			.where(eq(users.id, userId));
		await tx.delete(authApiKeys).where(eq(authApiKeys.userId, userId));
		await tx
			.update(agentApiKeys)
			.set({ revokedAt: now })
			.where(
				and(eq(agentApiKeys.userId, userId), isNull(agentApiKeys.revokedAt)),
			);
		await tx
			.delete(agentApiAuthorizationCodes)
			.where(eq(agentApiAuthorizationCodes.userId, userId));
		await tx
			.update(mcpOAuthTokens)
			.set({ revokedAt: now })
			.where(
				and(
					eq(mcpOAuthTokens.userId, userId),
					isNull(mcpOAuthTokens.revokedAt),
				),
			);
		await tx.delete(mcpOAuthCodes).where(eq(mcpOAuthCodes.userId, userId));
		const ownedApps = await tx
			.select({ id: developerApps.id })
			.from(developerApps)
			.where(eq(developerApps.ownerId, userId));
		if (ownedApps.length > 0) {
			await tx
				.update(developerApiKeys)
				.set({ revokedAt: now })
				.where(
					and(
						inArray(
							developerApiKeys.appId,
							ownedApps.map((app) => app.id),
						),
						isNull(developerApiKeys.revokedAt),
					),
				);
		}
	});
}

export async function reprovisionUser(userId: User.UserId) {
	await db().delete(forkUserAccess).where(eq(forkUserAccess.userId, userId));
}

export function parseActiveFromPatch(body: unknown): boolean | null {
	if (!body || typeof body !== "object") return null;
	const operations = (body as { Operations?: unknown }).Operations;
	if (!Array.isArray(operations)) return null;
	for (const operation of operations) {
		if (!operation || typeof operation !== "object") continue;
		const { path, value } = operation as { path?: unknown; value?: unknown };
		const candidate =
			typeof path === "string" && path.toLowerCase() === "active"
				? value
				: value && typeof value === "object"
					? (value as { active?: unknown }).active
					: undefined;
		if (candidate === undefined) continue;
		if (candidate === true || candidate === "true" || candidate === "True")
			return true;
		if (candidate === false || candidate === "false" || candidate === "False")
			return false;
	}
	return null;
}
