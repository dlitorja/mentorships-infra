import { pgTable, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const seatStatusEnum = pgEnum("seat_status", ["active", "grace", "released"]);

export type SeatStatus = "active" | "grace" | "released";

export const seatReservations = pgTable(
  "seat_reservations",
  {
    id: text("id").primaryKey(),
    convexId: text("convex_id"),
    mentorId: text("mentor_id").notNull(),
    instructorId: text("instructor_id"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionPackId: text("session_pack_id").notNull().unique(),
    seatExpiresAt: timestamp("seat_expires_at").notNull(),
    gracePeriodEndsAt: timestamp("grace_period_ends_at"),
    finalWarningNotificationSentAt: timestamp("final_warning_notification_sent_at"),
    status: seatStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    mentorIdIdx: index("seat_reservations_mentor_id_idx").on(t.mentorId),
    instructorIdIdx: index("seat_reservations_instructor_id_idx").on(t.instructorId),
    userIdIdx: index("seat_reservations_user_id_idx").on(t.userId),
    statusIdx: index("seat_reservations_status_idx").on(t.status),
    seatExpiresAtIdx: index("seat_reservations_seat_expires_at_idx").on(t.seatExpiresAt),
    mentorIdStatusIdx: index("seat_reservations_mentor_id_status_idx").on(t.mentorId, t.status),
    userIdMentorIdIdx: index("seat_reservations_user_id_mentor_id_idx").on(t.userId, t.mentorId),
  })
);

