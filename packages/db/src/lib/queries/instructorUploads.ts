import { eq, and, or, isNull, isNotNull, lt, desc, asc, sql, inArray } from "drizzle-orm";
import { db } from "../drizzle";
import { instructorUploads, uploadStatusEnum, transferStatusEnum } from "../../schema";
import type { InstructorUpload } from "../../schema";

export type { InstructorUpload, NewInstructorUpload } from "../../schema";

/**
 * Get all uploads for an instructor
 */
export async function getInstructorUploads(instructorId: string) {
  return db
    .select()
    .from(instructorUploads)
    .where(eq(instructorUploads.instructorId, instructorId))
    .orderBy(desc(instructorUploads.createdAt));
}

/**
 * Get uploads for multiple instructors (for video editor access)
 */
export async function getUploadsForInstructors(instructorIds: string[]) {
  if (instructorIds.length === 0) return [];
  
  return db
    .select()
    .from(instructorUploads)
    .where(inArray(instructorUploads.instructorId, instructorIds))
    .orderBy(desc(instructorUploads.createdAt));
}

/**
 * Get upload by ID
 */
export async function getUploadById(id: string) {
  const [upload] = await db
    .select()
    .from(instructorUploads)
    .where(eq(instructorUploads.id, id))
    .limit(1);
  
  return upload;
}

/**
 * Get uploads by status
 */
export async function getUploadsByStatus(status: typeof uploadStatusEnum.enumValues[number]) {
  return db
    .select()
    .from(instructorUploads)
    .where(eq(instructorUploads.status, status))
    .orderBy(desc(instructorUploads.createdAt));
}

/**
 * Get uploads ready for archiving (completed more than X days ago)
 */
export async function getFilesForArchiving(daysOld: number) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  return db
    .select()
    .from(instructorUploads)
    .where(
      and(
        eq(instructorUploads.status, "completed"),
        or(
          isNull(instructorUploads.transferStatus),
          and(
            isNotNull(instructorUploads.transferStatus),
            ne(instructorUploads.transferStatus, "completed")
          )
        ),
        lt(instructorUploads.createdAt, cutoffDate)
      )
    )
    .orderBy(asc(instructorUploads.createdAt))
    .limit(100);
}

/**
 * Get failed transfers for retry
 */
export async function getFailedTransfers() {
  return db
    .select()
    .from(instructorUploads)
    .where(
      and(
        eq(instructorUploads.transferStatus, "failed"),
        sql`${instructorUploads.transferRetryCount} < 4`
      )
    )
    .orderBy(asc(instructorUploads.createdAt));
}

/**
 * Get total storage used by an instructor
 */
export async function getInstructorStorageUsage(instructorId: string) {
  const result = await db
    .select({
      totalSize: sql<number>`COALESCE(SUM(${instructorUploads.size}), 0)`,
      fileCount: sql<number>`COUNT(*)`,
    })
    .from(instructorUploads)
    .where(
      and(
        eq(instructorUploads.instructorId, instructorId),
        isNull(instructorUploads.deletedAt)
      )
    );
  
  return result[0] || { totalSize: 0, fileCount: 0 };
}

/**
 * Create a new upload record
 */
export async function createUpload(data: {
  id: string;
  instructorId: string;
  filename: string;
  originalName: string;
  contentType: string;
  size: number;
}) {
  const [upload] = await db
    .insert(instructorUploads)
    .values({
      ...data,
      status: "pending",
    })
    .returning();
  
  return upload;
}

/**
 * Update upload status and B2 info
 */
export async function updateUploadStarted(
  id: string,
  b2UploadId: string
) {
  const [upload] = await db
    .update(instructorUploads)
    .set({
      b2UploadId,
      status: "uploading",
      updatedAt: new Date(),
    })
    .where(eq(instructorUploads.id, id))
    .returning();
  
  return upload;
}

/**
 * Mark upload as completed
 */
export async function completeUpload(id: string, b2FileId: string) {
  const [upload] = await db
    .update(instructorUploads)
    .set({
      b2FileId,
      status: "completed",
      transferStatus: "pending",
      updatedAt: new Date(),
    })
    .where(eq(instructorUploads.id, id))
    .returning();
  
  return upload;
}

/**
 * Update transfer status during archiving
 */
export async function updateTransferStatus(
  id: string,
  transferStatus: typeof transferStatusEnum.enumValues[number]
) {
  const [upload] = await db
    .update(instructorUploads)
    .set({
      transferStatus,
      updatedAt: new Date(),
    })
    .where(eq(instructorUploads.id, id))
    .returning();
  
  return upload;
}

/**
 * Mark upload as archived (S3 copy complete)
 */
export async function archiveUpload(
  id: string,
  s3Key: string,
  s3Url: string
) {
  const [upload] = await db
    .update(instructorUploads)
    .set({
      status: "archived",
      transferStatus: "completed",
      archivedAt: new Date(),
      s3Key,
      s3Url,
      updatedAt: new Date(),
    })
    .where(eq(instructorUploads.id, id))
    .returning();
  
  return upload;
}

/**
 * Mark upload as failed
 */
export async function failUpload(id: string, errorMessage: string) {
  const [upload] = await db
    .update(instructorUploads)
    .set({
      status: "failed",
      errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(instructorUploads.id, id))
    .returning();
  
  return upload;
}

/**
 * Increment transfer retry count
 */
export async function incrementTransferRetry(id: string) {
  const [upload] = await db
    .update(instructorUploads)
    .set({
      transferStatus: "failed",
      transferRetryCount: sql`${instructorUploads.transferRetryCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(instructorUploads.id, id))
    .returning();
  
  return upload;
}

/**
 * Soft delete an upload
 */
export async function softDeleteUpload(id: string) {
  const [upload] = await db
    .update(instructorUploads)
    .set({
      status: "deleted",
      updatedAt: new Date(),
    })
    .where(eq(instructorUploads.id, id))
    .returning();
  
  return upload;
}

/**
 * Permanently delete an upload (admin only)
 */
export async function permanentlyDeleteUpload(id: string) {
  await db
    .delete(instructorUploads)
    .where(eq(instructorUploads.id, id));
}

/**
 * Mark instructor as notified about archival
 */
export async function markUploadNotified(id: string) {
  await db
    .update(instructorUploads)
    .set({
      notifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(instructorUploads.id, id));
}
