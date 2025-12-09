import { eq, desc, sql, and, gte, lte } from "drizzle-orm";
import { db } from "../drizzle";
import { sessionPacks, seatReservations, mentors, users } from "../../schema";
import type { SessionPackStatus } from "../../schema/sessionPacks";

type SessionPack = typeof sessionPacks.$inferSelect;
type SessionPackWithMentor = SessionPack & {
  mentor: typeof mentors.$inferSelect;
  mentorUser: typeof users.$inferSelect;
};

/**
 * Get session pack by payment ID
 */
export async function getSessionPackByPaymentId(
  paymentId: string
): Promise<SessionPack | null> {
  const [pack] = await db
    .select()
    .from(sessionPacks)
    .where(eq(sessionPacks.paymentId, paymentId))
    .limit(1);

  return pack || null;
}

/**
 * Update session pack status
 */
export async function updateSessionPackStatus(
  packId: string,
  status: SessionPackStatus,
  remainingSessions?: number
): Promise<SessionPack> {
  const updatePayload: {
    status: SessionPackStatus;
    updatedAt: Date;
    remainingSessions?: number;
  } = {
    status,
    updatedAt: new Date(),
  };

  if (remainingSessions !== undefined) {
    updatePayload.remainingSessions = remainingSessions;
  }

  const [updated] = await db
    .update(sessionPacks)
    .set(updatePayload)
    .where(eq(sessionPacks.id, packId))
    .returning();

  if (!updated) {
    throw new Error(`Session pack ${packId} not found`);
  }

  return updated;
}

/**
 * Release seat by pack ID
 */
export async function releaseSeatByPackId(packId: string): Promise<void> {
  await db
    .update(seatReservations)
    .set({
      status: "released",
      updatedAt: new Date(),
    })
    .where(eq(seatReservations.sessionPackId, packId));
}

/**
 * Get user's active session packs with pagination
 */
export async function getUserActiveSessionPacks(
  userId: string,
  page: number = 1,
  pageSize: number = 20
): Promise<{ items: SessionPack[]; total: number; page: number; pageSize: number }> {
  const offset = (page - 1) * pageSize;

  // Get total count (only active packs)
  const totalResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(sessionPacks)
    .where(
      and(
        eq(sessionPacks.userId, userId),
        eq(sessionPacks.status, "active")
      )
    );

  const total = Number(totalResult[0]?.count || 0);

  // Get paginated items ordered by createdAt DESC (newest first, only active)
  const items = await db
    .select()
    .from(sessionPacks)
    .where(
      and(
        eq(sessionPacks.userId, userId),
        eq(sessionPacks.status, "active")
      )
    )
    .orderBy(desc(sessionPacks.createdAt))
    .limit(pageSize)
    .offset(offset);

  return {
    items,
    total,
    page,
    pageSize,
  };
}

/**
 * Increment remaining sessions and atomically update status if needed
 */
export async function incrementRemainingSessions(
  packId: string
): Promise<SessionPack> {
  // Atomic update with status flip in SQL using CASE statement
  const [updated] = await db
    .update(sessionPacks)
    .set({
      remainingSessions: sql`${sessionPacks.remainingSessions} + 1`,
      status: sql`CASE 
        WHEN ${sessionPacks.status} = 'depleted' AND (${sessionPacks.remainingSessions} + 1) > 0 
        THEN 'active' 
        ELSE ${sessionPacks.status} 
      END`,
      updatedAt: new Date(),
    })
    .where(eq(sessionPacks.id, packId))
    .returning();

  if (!updated) {
    throw new Error(`Session pack ${packId} not found`);
  }

  return updated;
}

/**
 * Get user's active session packs with mentor information
 */
export async function getUserSessionPacksWithMentors(
  userId: string,
  limit: number = 100,
  offset: number = 0
): Promise<SessionPackWithMentor[]> {
  const now = new Date();

  const results = await db
    .select({
      sessionPack: sessionPacks,
      mentor: mentors,
      mentorUser: users,
    })
    .from(sessionPacks)
    .innerJoin(mentors, eq(sessionPacks.mentorId, mentors.id))
    .innerJoin(users, eq(mentors.userId, users.id))
    .where(
      and(
        eq(sessionPacks.userId, userId),
        eq(sessionPacks.status, "active"),
        gte(sessionPacks.expiresAt, now)
      )
    )
    .orderBy(desc(sessionPacks.createdAt))
    .limit(limit)
    .offset(offset);

  return results.map((r) => ({
    ...r.sessionPack,
    mentor: r.mentor,
    mentorUser: r.mentorUser,
  }));
}

/**
 * Get total remaining sessions across all active packs for a user
 */
export async function getUserTotalRemainingSessions(
  userId: string
): Promise<number> {
  const now = new Date();

  const result = await db
    .select({
      total: sql<number>`COALESCE(SUM(${sessionPacks.remainingSessions}), 0)`,
    })
    .from(sessionPacks)
    .where(
      and(
        eq(sessionPacks.userId, userId),
        eq(sessionPacks.status, "active"),
        gte(sessionPacks.expiresAt, now)
      )
    );

  return Number(result[0]?.total || 0);
}

/**
 * Decrement remaining sessions atomically and update status if depleted
 */
export async function decrementRemainingSessions(
  packId: string
): Promise<SessionPack> {
  // Atomic update with status flip in SQL using CASE statement
  const [updated] = await db
    .update(sessionPacks)
    .set({
      remainingSessions: sql`GREATEST(${sessionPacks.remainingSessions} - 1, 0)`,
      status: sql`CASE 
        WHEN (${sessionPacks.remainingSessions} - 1) <= 0 
        THEN 'depleted' 
        ELSE ${sessionPacks.status} 
      END`,
      updatedAt: new Date(),
    })
    .where(eq(sessionPacks.id, packId))
    .returning();

  if (!updated) {
    throw new Error(`Session pack ${packId} not found`);
  }

  return updated;
}

/**
 * Get session pack by ID
 */
export async function getSessionPackById(
  packId: string
): Promise<SessionPack | null> {
  const [pack] = await db
    .select()
    .from(sessionPacks)
    .where(eq(sessionPacks.id, packId))
    .limit(1);

  return pack || null;
}

/**
 * Update seat reservation status and grace period
 */
export async function updateSeatReservationStatus(
  packId: string,
  status: "active" | "grace" | "released",
  gracePeriodEndsAt?: Date
): Promise<void> {
  const updateData: {
    status: "active" | "grace" | "released";
    gracePeriodEndsAt?: Date;
    updatedAt: Date;
  } = {
    status,
    updatedAt: new Date(),
  };

  if (gracePeriodEndsAt) {
    updateData.gracePeriodEndsAt = gracePeriodEndsAt;
  }

  await db
    .update(seatReservations)
    .set(updateData)
    .where(eq(seatReservations.sessionPackId, packId));
}

/**
 * Get expired session packs that need seat release
 * Returns packs where:
 * - Pack is expired AND all scheduled sessions are completed
 * - OR grace period has expired
 */
export async function getExpiredPacksNeedingSeatRelease(): Promise<
  SessionPack[]
> {
  const now = new Date();

  // Get packs that are expired or depleted
  const expiredPacks = await db
    .select()
    .from(sessionPacks)
    .where(
      and(
        sql`${sessionPacks.status} IN ('expired', 'depleted')`,
        lte(sessionPacks.expiresAt, now)
      )
    );

  return expiredPacks;
}

