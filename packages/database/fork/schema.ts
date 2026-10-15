import { mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";

export const forkUserAccess = mysqlTable("fork_user_access", {
	userId: varchar("userId", { length: 15 }).notNull().primaryKey(),
	disabledAt: timestamp("disabledAt").notNull().defaultNow(),
});
