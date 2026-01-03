import { pgTable, serial, text, timestamp, boolean, uuid, pgEnum, unique, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const waitlistTypeEnum = pgEnum("waitlist_type", ["one-on-one", "group"]);

export const waitlist = pgTable("waitlist", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  instructorSlug: text("instructor_slug").notNull(),
  type: waitlistTypeEnum("type").notNull(),
  notified: boolean("notified").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueConstraint: unique("unique_waitlist_entry").on(table.email, table.instructorSlug, table.type),
  userIdIndex: index("waitlist_user_id_idx").on(table.userId),
  emailInstructorTypeIndex: index("waitlist_email_instructor_type_idx").on(table.email, table.instructorSlug, table.type),
}));
