import { jsonb, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { mentors } from "./mentors";
import { instructors } from "./instructors";
import { sessionPacks } from "./sessionPacks";
import { users } from "./users";

export type MenteeOnboardingImageObject = {
  path: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
};

export const menteeOnboardingSubmissions = pgTable(
  "mentee_onboarding_submissions",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  mentorId: uuid("mentor_id")
    .notNull()
    .references(() => mentors.id, { onDelete: "cascade" }),
  instructorId: uuid("instructor_id").references(() => instructors.id, { onDelete: "set null" }),
  sessionPackId: uuid("session_pack_id")
    .notNull()
    .references(() => sessionPacks.id, { onDelete: "cascade" }),
  goals: text("goals").notNull(),
  imageObjects: jsonb("image_objects").$type<MenteeOnboardingImageObject[]>().notNull().default([]),
  reviewedAt: timestamp("reviewed_at"),
  reviewedByUserId: text("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
},
  (t) => ({
    instructorIdIdx: index("mentee_onboarding_submissions_instructor_id_idx").on(t.instructorId),
  })
);


