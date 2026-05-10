import { pgTable, text, integer, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { seatReservations } from "./seatReservations";

export type MentorWorkingHoursInterval = {
  start: string;
  end: string;
};

export type MentorWorkingHours = Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, MentorWorkingHoursInterval[]>>;

export const mentors = pgTable("mentors", {
  id: text("id").primaryKey(),
  convexId: text("convex_id"),
  userId: text("user_id").notNull().unique(),
  googleCalendarId: text("google_calendar_id"),
  googleRefreshToken: text("google_refresh_token"),
  timeZone: text("time_zone"),
  workingHours: jsonb("working_hours").$type<MentorWorkingHours>(),
  maxActiveStudents: integer("max_active_students").notNull().default(10),
  bio: text("bio"),
  pricing: numeric("pricing", { precision: 10, scale: 2 }),
  oneOnOneInventory: integer("one_on_one_inventory").notNull().default(0),
  groupInventory: integer("group_inventory").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const mentorsRelations = relations(mentors, ({ many }) => ({
  seatReservations: many(seatReservations),
}));

