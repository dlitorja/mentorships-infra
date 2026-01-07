import { pgTable, uuid, text, integer, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";

export type MentorWorkingHoursInterval = {
  start: string; // "HH:MM" 24h
  end: string; // "HH:MM" 24h
};

/**
 * Working hours keyed by day of week (0=Sunday..6=Saturday).
 * If null, we don't apply any working-hours filtering (calendar-only availability).
 */
export type MentorWorkingHours = Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, MentorWorkingHoursInterval[]>>;

export const mentors = pgTable("mentors", {
  id: uuid("id")
    .primaryKey()
    .defaultRandom(),
  // References Clerk user ID from users table
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  /**
   * Google Calendar integration
   *
   * We store the refresh token for the mentor's Google account so we can:
   * - read availability (free/busy)
   * - create events for booked sessions
   *
   * NOTE: This is sensitive and should never be logged or returned to clients.
   */
  googleCalendarId: text("google_calendar_id"), // defaults to "primary" at usage-time
  googleRefreshToken: text("google_refresh_token"),

  /**
   * Scheduling preferences
   *
   * timeZone should be an IANA timezone, e.g. "America/Los_Angeles".
   * workingHours are optional; when set, they filter availability slots.
   */
  timeZone: text("time_zone"),
  workingHours: jsonb("working_hours").$type<MentorWorkingHours>(),
  maxActiveStudents: integer("max_active_students").notNull().default(10),
  bio: text("bio"),
  pricing: numeric("pricing", { precision: 10, scale: 2 }),

  /**
   * Inventory counts for waitlist system
   *
   * When inventory > 0, show "Buy Now" button on instructor profile
   * When inventory === 0, show "Join Waitlist" button instead
   */
  oneOnOneInventory: integer("one_on_one_inventory").notNull().default(0),
  groupInventory: integer("group_inventory").notNull().default(0),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Soft deletion for audit trails
  deletedAt: timestamp("deleted_at"),
});

export const mentorsRelations = relations(mentors, ({ many }) => ({
  seatReservations: many(seatReservations),
}));

import { seatReservations } from "./seatReservations";

