import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { mentors } from "./mentors";
import { sessionPacks } from "./sessionPacks";
import { users } from "./users";

export type MenteeOnboardingImageObject = {
  path: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
};

export const menteeOnboardingSubmissions = pgTable("mentee_onboarding_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  mentorId: uuid("mentor_id")
    .notNull()
    .references(() => mentors.id, { onDelete: "cascade" }),
  sessionPackId: uuid("session_pack_id")
    .notNull()
    .references(() => sessionPacks.id, { onDelete: "cascade" }),
  goals: text("goals").notNull(),
  imageObjects: jsonb("image_objects").$type<MenteeOnboardingImageObject[]>().notNull().default([]),
  reviewedAt: timestamp("reviewed_at"),
  reviewedByUserId: text("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});


