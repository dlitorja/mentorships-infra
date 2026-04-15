import { pgTable, uuid, text, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const instructors = pgTable(
  "instructors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    tagline: text("tagline"),
    bio: text("bio"),
    specialties: text("specialties").array(),
    background: text("background").array(),
    profileImageUrl: text("profile_image_url"),
    profileImageUploadPath: text("profile_image_upload_path"),
    portfolioImages: text("portfolio_images").array(),
    socials: jsonb("socials").$type<{
      twitter?: string;
      instagram?: string;
      youtube?: string;
      bluesky?: string;
      website?: string;
      artstation?: string;
    }>(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: index("instructors_slug_idx").on(t.slug),
    isActiveIdx: index("instructors_is_active_idx").on(t.isActive),
    createdAtIdx: index("instructors_created_at_idx").on(t.createdAt),
  })
);

export const instructorTestimonials = pgTable(
  "instructor_testimonials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instructorId: uuid("instructor_id")
      .notNull()
      .references(() => instructors.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    instructorIdIdx: index("instructor_testimonials_instructor_id_idx").on(t.instructorId),
    createdAtIdx: index("instructor_testimonials_created_at_idx").on(t.createdAt),
  })
);

export const menteeResults = pgTable(
  "mentee_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instructorId: uuid("instructor_id")
      .notNull()
      .references(() => instructors.id, { onDelete: "cascade" }),
    imageUrl: text("image_url"),
    imageUploadPath: text("image_upload_path"),
    studentName: text("student_name"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    instructorIdIdx: index("mentee_results_instructor_id_idx").on(t.instructorId),
    createdByIdx: index("mentee_results_created_by_idx").on(t.createdBy),
    createdAtIdx: index("mentee_results_created_at_idx").on(t.createdAt),
  })
);

export type Instructor = typeof instructors.$inferSelect;
export type NewInstructor = typeof instructors.$inferInsert;
export type InstructorTestimonial = typeof instructorTestimonials.$inferSelect;
export type NewInstructorTestimonial = typeof instructorTestimonials.$inferInsert;
export type MenteeResult = typeof menteeResults.$inferSelect;
export type NewMenteeResult = typeof menteeResults.$inferInsert;
