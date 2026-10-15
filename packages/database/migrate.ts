import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "@cap/database";
import { isOidcMode } from "@cap/database/auth/domain-utils";
import { DrizzleQueryError } from "drizzle-orm";
import { migrate } from "drizzle-orm/mysql2/migrator";

import { runOrgIdBackfill } from "./migrations/orgid_backfill.ts";
import { runSpaceMemberRoleBackfill } from "./migrations/space_member_role_backfill.ts";

async function runMigrate() {
	await migrate(db(), {
		migrationsFolder: path.join(process.cwd(), "/migrations"),
	});
}

async function runForkMigrate() {
	const migrationsFolder = ["fork-migrations", "fork/migrations"]
		.map((folder) => path.join(process.cwd(), folder))
		.find((folder) => existsSync(folder));
	if (!migrationsFolder) {
		if (isOidcMode()) throw new Error("fork migrations folder not found");
		return;
	}
	await migrate(db(), {
		migrationsFolder,
		migrationsTable: "__fork_migrations",
	});
}

function errorIsOrgIdMigration(e: unknown): e is DrizzleQueryError {
	return (
		e instanceof DrizzleQueryError &&
		e.query ===
			"ALTER TABLE `videos` MODIFY COLUMN `orgId` varchar(15) NOT NULL;"
	);
}

export async function migrateDb() {
	try {
		await runMigrate();
	} catch (e) {
		if (!errorIsOrgIdMigration(e)) throw e;

		console.log("non-null videos.orgId migration failed, running backfill");

		await runOrgIdBackfill();

		try {
			await runMigrate();
		} catch (retryError) {
			if (errorIsOrgIdMigration(retryError)) {
				throw new Error(
					"videos.orgId backfill failed, you will need to manually update the videos.orgId column before attempting to migrate again.",
				);
			}
			throw retryError;
		}
	}

	await runSpaceMemberRoleBackfill();

	await runForkMigrate();
}
