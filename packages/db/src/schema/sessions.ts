import { pgTable, uuid, text, timestamp, pgEnum, boolean } from "drizzle-orm/pg-core";
import { users } from "./users";
import { mentors } from "./mentors";
import { sessionPacks } from "./sessionPacks";

export const sessionStatusEnum = pgEnum("session_status", [
  "scheduled",
  "completed",
  "canceled",
  "no_show",
]);

export const sessions = pgTable("sessions", {
  id: uuid("id")
    .primaryKey()
    .defaultRandom(),
  mentorId: uuid("mentor_id")
    .notNull()
    .references(() => mentors.id, { onDelete: "cascade" }),
  // References Clerk user ID from users table
  studentId: text("student_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sessionPackId: uuid("session_pack_id")
    .notNull()
    .references(() => sessionPacks.id, { onDelete: "cascade" }),
  scheduledAt: timestamp("scheduled_at").notNull(),
  completedAt: timestamp("completed_at"),
  canceledAt: timestamp("canceled_at"),
  status: sessionStatusEnum("status").notNull().default("scheduled"),
  // Recording fields
  recordingConsent: boolean("recording_consent").notNull().default(false),
  recordingUrl: text("recording_url"),
  recordingExpiresAt: timestamp("recording_expires_at"),
  // Google Calendar integration
  googleCalendarEventId: text("google_calendar_event_id").unique(),
  // Notes
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

