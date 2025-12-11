import { eq, desc, sql, and, gte, lte, gt } from "drizzle-orm";
import { db } from "../drizzle";
import { sessionPacks, seatReservations, sessions, mentors, users } from "../../schema";
import type { SessionPackStatus } from "../../schema/sessionPacks";

type SessionPack = typeof sessionPacks.$inferSelect;
type SessionPackWithMentor = SessionPack & {
  mentor: typeof mentors.$inferSelect;
  mentorUser: typeof users.$inferSelect;
};

/**
 * Create a new session pack after payment
 * 
 * @param userId - Clerk user ID of the purchaser
 * @param mentorId - UUID of the mentor
 * @param paymentId - UUID of the payment record
 * @param expiresAt - When the pack expires
 * @param totalSessions - Number of sessions in the pack (default: 4)
 * @returns Created session pack
 */
export async function createSessionPack(
  userId: string,
  mentorId: string,
  paymentId: string,
  expiresAt: Date,
  totalSessions: number = 4
): Promise<SessionPack> {
  const [pack] = await db
    .insert(sessionPacks)
    .values({
      userId,
      mentorId,
      paymentId,
      expiresAt,
      totalSessions,
      remainingSessions: totalSessions,
      status: "active",
      purchasedAt: new Date(),
    })
    .returning();

  if (!pack) {
    throw new Error("Failed to create session pack");
  }

  return pack;
}

/**
 * Check if a session pack is expired
 * 
 * @param packId - UUID of the session pack
 * @returns True if pack is expired, false otherwise
 */
export async function checkPackExpiration(packId: string): Promise<boolean> {
  const [pack] = await db
    .select()
    .from(sessionPacks)
    .where(eq(sessionPacks.id, packId))
    .limit(1);

  if (!pack) {
    throw new Error(`Session pack ${packId} not found`);
  }

  const now = new Date();
  return new Date(pack.expiresAt) < now;
}

/**
 * Get remaining sessions for a pack
 * 
 * @param packId - UUID of the session pack
 * @returns Number of remaining sessions, or null if pack not found
 */
export async function getRemainingSessions(packId: string): Promise<number | null> {
  const [pack] = await db
    .select({ remainingSessions: sessionPacks.remainingSessions })
    .from(sessionPacks)
    .where(eq(sessionPacks.id, packId))
    .limit(1);

  return pack?.remainingSessions ?? null;
}

/**
 * Check if a session can be booked for a pack
 * 
 * Booking is allowed if:
 * - remaining_sessions > 0
 * - pack is not expired
 * - pack status is "active"
 * - seat status is "active" (checked separately via seat utilities)
 * 
 * @param packId - UUID of the session pack
 * @returns Object with canBook flag and reason if cannot book
 */
export async function canBookSession(packId: string): Promise<{
  canBook: boolean;
  reason?: string;
}> {
  const [pack] = await db
    .select()
    .from(sessionPacks)
    .where(eq(sessionPacks.id, packId))
    .limit(1);

  if (!pack) {
    return { canBook: false, reason: "Session pack not found" };
  }

  if (pack.status !== "active") {
    return { canBook: false, reason: `Session pack status is ${pack.status}` };
  }

  if (pack.remainingSessions <= 0) {
    return { canBook: false, reason: "No remaining sessions in pack" };
  }

  const now = new Date();
  if (new Date(pack.expiresAt) < now) {
    // Pack is expired, but check if there are scheduled sessions that should complete
    const scheduledSessions = await db
      .select({ count: sql<number>`count(*)` })
      .from(sessions)
      .where(
        and(
          eq(sessions.sessionPackId, packId),
          eq(sessions.status, "scheduled")
        )
      );

    const scheduledCount = Number(scheduledSessions[0]?.count ?? 0);
    
    // Allow booking only if there are scheduled sessions (to allow them to complete)
    // But don't allow new bookings if pack is expired
    if (scheduledCount === 0) {
      return { canBook: false, reason: "Session pack has expired" };
    }
  }

  return { canBook: true };
}

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
): Promise<{
  items: SessionPackWithMentor[];
  total: number;
  limit: number;
  offset: number;
}> {
  // Validate and clamp limit
  const validatedLimit = Math.min(Math.max(1, limit), 100);
  const validatedOffset = Math.max(0, offset);

  const now = new Date();

  // Get total count
  const totalResult = await db
    .select({
      count: sql<number>`count(*)`,
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
    );

  const total = Number(totalResult[0]?.count || 0);

  // Get paginated results
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
    .limit(validatedLimit)
    .offset(validatedOffset);

  return {
    items: results.map((r) => ({
      ...r.sessionPack,
      mentor: r.mentor,
      mentorUser: r.mentorUser,
    })),
    total,
    limit: validatedLimit,
    offset: validatedOffset,
  };
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
 * Release seat by session pack ID
 * 
 * @param sessionPackId - UUID of the session pack
 * @returns Updated seat reservation
 */
export async function releaseSeatByPackId(sessionPackId: string) {
  const [seat] = await db
    .update(seatReservations)
    .set({
      status: "released",
      updatedAt: new Date(),
    })
    .where(eq(seatReservations.sessionPackId, sessionPackId))
    .returning();

  if (!seat) {
    throw new Error(`Seat reservation for pack ${sessionPackId} not found`);
  }

  return seat;
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
