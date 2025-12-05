import { pgTable, uuid, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";
import { mentors } from "./mentors";
import { payments } from "./payments";

export const sessionPackStatusEnum = pgEnum("session_pack_status", [
  "active",
  "depleted",
  "expired",
  "refunded",
]);

export const sessionPacks = pgTable("session_packs", {
  id: uuid("id")
    .primaryKey()
    .defaultRandom(),
  // References Clerk user ID from users table
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  mentorId: uuid("mentor_id")
    .notNull()
    .references(() => mentors.id, { onDelete: "cascade" }),
  totalSessions: integer("total_sessions").notNull().default(4),
  remainingSessions: integer("remaining_sessions").notNull().default(4),
  purchasedAt: timestamp("purchased_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  status: sessionPackStatusEnum("status").notNull().default("active"),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => payments.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

