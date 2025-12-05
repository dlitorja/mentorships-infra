import { pgTable, uuid, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const mentors = pgTable("mentors", {
  id: uuid("id")
    .primaryKey()
    .defaultRandom(),
  // References Clerk user ID from users table
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  maxActiveStudents: integer("max_active_students").notNull().default(10),
  bio: text("bio"),
  pricing: numeric("pricing", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

