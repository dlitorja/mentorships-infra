import { pgTable, uuid, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { mentors } from "./mentors";
import { sessionPacks } from "./sessionPacks";

export const seatStatusEnum = pgEnum("seat_status", ["active", "grace", "released"]);

export const seatReservations = pgTable("seat_reservations", {
  id: uuid("id")
    .primaryKey()
    .defaultRandom(),
  mentorId: uuid("mentor_id")
    .notNull()
    .references(() => mentors.id, { onDelete: "cascade" }),
  // References Clerk user ID from users table
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sessionPackId: uuid("session_pack_id")
    .notNull()
    .references(() => sessionPacks.id, { onDelete: "cascade" }),
  seatExpiresAt: timestamp("seat_expires_at").notNull(),
  gracePeriodEndsAt: timestamp("grace_period_ends_at"),
  status: seatStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Index for joining with session packs
  sessionPackIdIdx: index("seat_reservations_session_pack_id_idx").on(table.sessionPackId),
  // Index for querying user's active seats
  userIdStatusIdx: index("seat_reservations_user_id_status_idx").on(table.userId, table.status),
  // Index for status filtering
  statusIdx: index("seat_reservations_status_idx").on(table.status),
  // Index for grace period checks
  gracePeriodEndsAtIdx: index("seat_reservations_grace_period_ends_at_idx").on(table.gracePeriodEndsAt),
}));

