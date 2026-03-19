import { pgTable, text, timestamp, integer, pgEnum, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const uploadStatusEnum = pgEnum("upload_status", [
  "pending",
  "uploading",
  "completed",
  "archived",
  "failed",
  "deleted",
]);

export const transferStatusEnum = pgEnum("transfer_status", [
  "pending",
  "transferring",
  "completed",
  "failed",
]);

export const instructorUploads = pgTable(
  "instructor_uploads",
  {
    id: text("id").primaryKey(),
    instructorId: text("instructor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    filename: text("filename").notNull(),
    originalName: text("original_name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),

    b2FileId: text("b2_file_id"),
    b2UploadId: text("b2_upload_id"),
    b2PartEtags: text("b2_part_etags"),

    status: uploadStatusEnum("status").notNull().default("pending"),
    errorMessage: text("error_message"),

    archivedAt: timestamp("archived_at"),
    s3Key: text("s3_key"),
    s3Url: text("s3_url"),
    transferStatus: transferStatusEnum("transfer_status"),
    transferRetryCount: integer("transfer_retry_count").default(0),
    notifiedAt: timestamp("notified_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => ({
    instructorIdIdx: index("instructor_uploads_instructor_id_idx").on(t.instructorId),
    statusIdx: index("instructor_uploads_status_idx").on(t.status),
    transferStatusIdx: index("instructor_uploads_transfer_status_idx").on(t.transferStatus),
    createdAtIdx: index("instructor_uploads_created_at_idx").on(t.createdAt),
    statusCreatedAtIdx: index("instructor_uploads_status_created_at_idx").on(t.status, t.createdAt),
    archivedAtIdx: index("instructor_uploads_archived_at_idx").on(t.archivedAt),
  })
);

export type InstructorUpload = typeof instructorUploads.$inferSelect;
export type NewInstructorUpload = typeof instructorUploads.$inferInsert;
