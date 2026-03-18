import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";

export const videoEditorAssignments = pgTable("video_editor_assignments", {
  id: text("id").primaryKey(),
  videoEditorId: text("video_editor_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  instructorId: text("instructor_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  assignedBy: text("assigned_by")
    .notNull()
    .references(() => users.id),
}, (t) => [
  uniqueIndex("video_editor_instructor_idx").on(t.videoEditorId, t.instructorId),
]);

export type VideoEditorAssignment = typeof videoEditorAssignments.$inferSelect;
export type NewVideoEditorAssignment = typeof videoEditorAssignments.$inferInsert;