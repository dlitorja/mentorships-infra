import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../drizzle";
import { menteeSessionCounts, instructors, users } from "../../schema";
import type { MenteeSessionCount } from "../../schema/menteeSessionCounts";

export type MenteeSessionCountWithDetails = MenteeSessionCount & {
  instructorName: string | null;
  instructorSlug: string | null;
  menteeEmail: string | null;
};

export async function getSessionCountsForMentee(
  userId: string
): Promise<MenteeSessionCountWithDetails[]> {
  const results = await db
    .select({
      id: menteeSessionCounts.id,
      userId: menteeSessionCounts.userId,
      instructorId: menteeSessionCounts.instructorId,
      sessionCount: menteeSessionCounts.sessionCount,
      notes: menteeSessionCounts.notes,
      createdAt: menteeSessionCounts.createdAt,
      updatedAt: menteeSessionCounts.updatedAt,
      instructorName: instructors.name,
      instructorSlug: instructors.slug,
      menteeEmail: users.email,
    })
    .from(menteeSessionCounts)
    .leftJoin(instructors, eq(menteeSessionCounts.instructorId, instructors.id))
    .leftJoin(users, eq(menteeSessionCounts.userId, users.id))
    .where(eq(menteeSessionCounts.userId, userId))
    .orderBy(desc(menteeSessionCounts.updatedAt));

  return results;
}

export async function getSessionCountForInstructorMentee(
  userId: string,
  instructorId: string
): Promise<MenteeSessionCount | null> {
  const [result] = await db
    .select()
    .from(menteeSessionCounts)
    .where(
      and(
        eq(menteeSessionCounts.userId, userId),
        eq(menteeSessionCounts.instructorId, instructorId)
      )
    )
    .limit(1);

  return result || null;
}

export async function getInstructorMenteesWithSessionCounts(
  instructorId: string
): Promise<MenteeSessionCountWithDetails[]> {
  const results = await db
    .select({
      id: menteeSessionCounts.id,
      userId: menteeSessionCounts.userId,
      instructorId: menteeSessionCounts.instructorId,
      sessionCount: menteeSessionCounts.sessionCount,
      notes: menteeSessionCounts.notes,
      createdAt: menteeSessionCounts.createdAt,
      updatedAt: menteeSessionCounts.updatedAt,
      instructorName: instructors.name,
      instructorSlug: instructors.slug,
      menteeEmail: users.email,
    })
    .from(menteeSessionCounts)
    .leftJoin(instructors, eq(menteeSessionCounts.instructorId, instructors.id))
    .leftJoin(users, eq(menteeSessionCounts.userId, users.id))
    .where(eq(menteeSessionCounts.instructorId, instructorId))
    .orderBy(desc(menteeSessionCounts.updatedAt));

  return results;
}

export async function createSessionCount(
  userId: string,
  instructorId: string,
  sessionCount: number,
  notes?: string
): Promise<MenteeSessionCount> {
  const [result] = await db
    .insert(menteeSessionCounts)
    .values({
      userId,
      instructorId,
      sessionCount,
      notes: notes || null,
    })
    .returning();

  return result;
}

export async function updateSessionCount(
  id: string,
  sessionCount: number,
  notes?: string
): Promise<MenteeSessionCount | null> {
  const [result] = await db
    .update(menteeSessionCounts)
    .set({
      sessionCount,
      notes: notes !== undefined ? notes : undefined,
      updatedAt: new Date(),
    })
    .where(eq(menteeSessionCounts.id, id))
    .returning();

  return result || null;
}

export async function adjustSessionCount(
  id: string,
  adjustment: number,
  notes?: string
): Promise<MenteeSessionCount | null> {
  const [existing] = await db
    .select()
    .from(menteeSessionCounts)
    .where(eq(menteeSessionCounts.id, id))
    .limit(1);

  if (!existing) {
    return null;
  }

  const newCount = existing.sessionCount + adjustment;

  const [result] = await db
    .update(menteeSessionCounts)
    .set({
      sessionCount: newCount,
      notes: notes !== undefined ? notes : existing.notes,
      updatedAt: new Date(),
    })
    .where(eq(menteeSessionCounts.id, id))
    .returning();

  return result || null;
}

export async function upsertSessionCount(
  userId: string,
  instructorId: string,
  sessionCount: number,
  notes?: string
): Promise<MenteeSessionCount> {
  const existing = await getSessionCountForInstructorMentee(userId, instructorId);

  if (existing) {
    const updated = await updateSessionCount(existing.id, sessionCount, notes);
    return updated!;
  }

  return createSessionCount(userId, instructorId, sessionCount, notes);
}

export async function deleteSessionCount(id: string): Promise<boolean> {
  const [result] = await db
    .delete(menteeSessionCounts)
    .where(eq(menteeSessionCounts.id, id))
    .returning({ id: menteeSessionCounts.id });

  return !!result;
}
