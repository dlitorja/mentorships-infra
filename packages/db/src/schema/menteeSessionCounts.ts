import { pgTable, uuid, integer, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";
import { instructors } from "./instructors";

export const menteeSessionCounts = pgTable(
  "mentee_session_counts",
  {
    id: uuid("id")
      .primaryKey()
      .defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    instructorId: uuid("instructor_id")
      .notNull()
      .references(() => instructors.id, { onDelete: "cascade" }),
    sessionCount: integer("session_count").notNull().default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx: index("mentee_session_counts_user_id_idx").on(t.userId),
    instructorIdIdx: index("mentee_session_counts_instructor_id_idx").on(t.instructorId),
    userInstructorUnique: uniqueIndex("mentee_session_counts_user_instructor_unique_idx").on(t.userId, t.instructorId),
  })
);

export type MenteeSessionCount = typeof menteeSessionCounts.$inferSelect;
export type NewMenteeSessionCount = typeof menteeSessionCounts.$inferInsert;
