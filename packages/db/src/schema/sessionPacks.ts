import { pgTable, text, integer, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const sessionPackStatusEnum = pgEnum("session_pack_status", [
  "active",
  "depleted",
  "expired",
  "refunded",
]);

export type SessionPackStatus = "active" | "depleted" | "expired" | "refunded";

export const sessionPacks = pgTable(
  "session_packs",
  {
    id: text("id").primaryKey(),
    convexId: text("convex_id"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mentorId: text("mentor_id").notNull(),
    totalSessions: integer("total_sessions").notNull().default(4),
    remainingSessions: integer("remaining_sessions").notNull().default(4),
    purchasedAt: timestamp("purchased_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at"),
    status: sessionPackStatusEnum("status").notNull().default("active"),
    paymentId: text("payment_id").notNull(),
    mentorshipType: text("mentorship_type").notNull().default("one-on-one"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => ({
    userIdIdx: index("session_packs_user_id_idx").on(t.userId),
    mentorIdIdx: index("session_packs_mentor_id_idx").on(t.mentorId),
    statusIdx: index("session_packs_status_idx").on(t.status),
    expiresAtIdx: index("session_packs_expires_at_idx").on(t.expiresAt),
    paymentIdIdx: index("session_packs_payment_id_idx").on(t.paymentId),
    userIdStatusExpiresAtIdx: index("session_packs_user_id_status_expires_at_idx").on(
      t.userId,
      t.status,
      t.expiresAt
    ),
  })
);

