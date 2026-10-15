import { eq } from "drizzle-orm";
import { forkUserAccess } from "../fork/schema.ts";
import { db } from "../index.ts";
import { isEmailOutsideDirectory, isOidcMode } from "./domain-utils.ts";

export type OidcRejection =
	| "OidcEmailMissing"
	| "OidcEmailUnverified"
	| "OidcNotInDirectory"
	| "OidcAccessDisabled";

export async function isUserAccessDisabled(userId: string): Promise<boolean> {
	if (!isOidcMode()) return false;
	const [row] = await db()
		.select({ userId: forkUserAccess.userId })
		.from(forkUserAccess)
		.where(eq(forkUserAccess.userId, userId))
		.limit(1);
	return row !== undefined;
}

export function evaluateOidcIdentity(identity: {
	email?: unknown;
	emailVerified?: unknown;
}): OidcRejection | null {
	if (typeof identity.email !== "string" || identity.email.trim() === "")
		return "OidcEmailMissing";
	if (identity.emailVerified !== true && identity.emailVerified !== "true")
		return "OidcEmailUnverified";
	if (isEmailOutsideDirectory(identity.email.trim().toLowerCase()))
		return "OidcNotInDirectory";
	return null;
}
