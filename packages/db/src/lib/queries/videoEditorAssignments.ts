import { eq, and } from "drizzle-orm";
import { db } from "../drizzle";
import { videoEditorAssignments } from "../../schema";

export type { VideoEditorAssignment, NewVideoEditorAssignment } from "../../schema";

/**
 * Get all assignments for a video editor
 */
export async function getVideoEditorAssignments(videoEditorId: string) {
  return db
    .select()
    .from(videoEditorAssignments)
    .where(eq(videoEditorAssignments.videoEditorId, videoEditorId));
}

/**
 * Get all assignments for an instructor (which video editors can access their files)
 */
export async function getInstructorAssignments(instructorId: string) {
  return db
    .select()
    .from(videoEditorAssignments)
    .where(eq(videoEditorAssignments.instructorId, instructorId));
}

/**
 * Check if a video editor is assigned to an instructor
 */
export async function isVideoEditorAssignedToInstructor(
  videoEditorId: string,
  instructorId: string
) {
  const [assignment] = await db
    .select()
    .from(videoEditorAssignments)
    .where(
      and(
        eq(videoEditorAssignments.videoEditorId, videoEditorId),
        eq(videoEditorAssignments.instructorId, instructorId)
      )
    )
    .limit(1);

  return !!assignment;
}

/**
 * Get instructor IDs assigned to a video editor
 */
export async function getAssignedInstructorIds(videoEditorId: string) {
  const assignments = await db
    .select({ instructorId: videoEditorAssignments.instructorId })
    .from(videoEditorAssignments)
    .where(eq(videoEditorAssignments.videoEditorId, videoEditorId));

  return assignments.map((a) => a.instructorId);
}

/**
 * Assign a video editor to an instructor
 */
export async function assignVideoEditorToInstructor(
  videoEditorId: string,
  instructorId: string,
  assignedBy: string
) {
  const [assignment] = await db
    .insert(videoEditorAssignments)
    .values({
      id: crypto.randomUUID(),
      videoEditorId,
      instructorId,
      assignedBy,
    })
    .onConflictDoNothing()
    .returning();

  return assignment;
}

/**
 * Remove a video editor assignment
 */
export async function removeVideoEditorAssignment(assignmentId: string) {
  await db
    .delete(videoEditorAssignments)
    .where(eq(videoEditorAssignments.id, assignmentId));
}

/**
 * Remove all assignments for a video editor
 */
export async function removeAllVideoEditorAssignments(videoEditorId: string) {
  await db
    .delete(videoEditorAssignments)
    .where(eq(videoEditorAssignments.videoEditorId, videoEditorId));
}

/**
 * Remove all assignments to an instructor
 */
export async function removeAllInstructorAssignments(instructorId: string) {
  await db
    .delete(videoEditorAssignments)
    .where(eq(videoEditorAssignments.instructorId, instructorId));
}