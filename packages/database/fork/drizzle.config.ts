import type { Config } from "drizzle-kit";

const URL = process.env.DATABASE_URL;

if (!URL) throw new Error("DATABASE_URL must be set!");
if (!URL.startsWith("mysql://"))
	throw new Error(
		"DATABASE_URL must be a 'mysql://' URI. Drizzle Kit doesn't support the fetch adapter!",
	);

export default {
	schema: "./fork/schema.ts",
	out: "./fork/migrations",
	dialect: "mysql",
	dbCredentials: { url: URL },
	migrations: { table: "__fork_migrations" },
	tablesFilter: ["fork_*"],
} satisfies Config;
