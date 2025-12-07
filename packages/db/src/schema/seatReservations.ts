import { pgTable, uuid, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";
import { mentors } from "./mentors";
import { sessionPacks } from "./sessionPacks";

export const seatStatusEnum = pgEnum("seat_status", ["active", "grace", "released"]);

export type SeatStatus = "active" | "grace" | "released";

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
});

