import { jsonb, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { instructors } from "./instructors";
import { sessionPacks } from "./sessionPacks";
import { users } from "./users";

export type StudentOnboardingImageObject = {
  path: string;
  storageId?: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
};

/**
 * Legacy image entry: some very old rows stored just a string path in
 * image_objects. Consumers should normalize with
 * `normalizeStudentOnboardingImageObjects` before accessing fields.
 */
export type LegacyStudentOnboardingImageValue = string | StudentOnboardingImageObject;

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
    imageObjects: jsonb("image_objects").$type<LegacyStudentOnboardingImageValue[]>().notNull().default([]),
    reviewedAt: timestamp("reviewed_at"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    instructorIdIdx: index("student_onboarding_submissions_instructor_id_idx").on(t.instructorId),
  })
);

/**
 * Normalizes legacy image_objects entries that may be plain strings into
 * the canonical object shape. Returns only entries that have a usable path.
 */
export function normalizeStudentOnboardingImageObjects(
  values: LegacyStudentOnboardingImageValue[] | null | undefined
): StudentOnboardingImageObject[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value): StudentOnboardingImageObject | null => {
      if (typeof value === "string") {
        return { path: value };
      }
      if (typeof value === "object" && value !== null && typeof value.path === "string") {
        return value as StudentOnboardingImageObject;
      }
      return null;
    })
    .filter((v): v is StudentOnboardingImageObject => v !== null);
}
