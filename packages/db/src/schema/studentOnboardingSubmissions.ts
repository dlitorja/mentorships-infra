import { jsonb, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { instructors } from "./instructors";
import { sessionPacks } from "./sessionPacks";
import { users } from "./users";

export type StudentOnboardingImageObject = {
  path: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
};

export const studentOnboardingSubmissions = pgTable(
  "student_onboarding_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    instructorId: uuid("instructor_id").references(() => instructors.id, { onDelete: "set null" }),
    sessionPackId: uuid("session_pack_id")
      .notNull()
      .references(() => sessionPacks.id, { onDelete: "cascade" }),
    goals: text("goals").notNull(),
    imageObjects: jsonb("image_objects").$type<StudentOnboardingImageObject[]>().notNull().default([]),
    reviewedAt: timestamp("reviewed_at"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    instructorIdIdx: index("student_onboarding_submissions_instructor_id_idx").on(t.instructorId),
  })
);
