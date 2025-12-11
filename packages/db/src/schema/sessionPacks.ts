import { pgTable, uuid, text, integer, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { mentors } from "./mentors";
import { payments } from "./payments";

export const sessionPackStatusEnum = pgEnum("session_pack_status", [
  "active",
  "depleted",
  "expired",
  "refunded",
]);

// Derive type from enum to avoid drift
export type SessionPackStatus = (typeof sessionPackStatusEnum.enumValues)[number];

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
}, (table) => ({
  // Index for querying user's active packs
  userIdStatusIdx: index("session_packs_user_id_status_idx").on(table.userId, table.status),
  // Index for expiration checks
  expiresAtIdx: index("session_packs_expires_at_idx").on(table.expiresAt),
  // Index for status filtering
  statusIdx: index("session_packs_status_idx").on(table.status),
  // Index for payment lookups
  paymentIdIdx: index("session_packs_payment_id_idx").on(table.paymentId),
}));
