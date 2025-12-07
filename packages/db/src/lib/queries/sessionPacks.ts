import { eq, and, gt, sql } from "drizzle-orm";
import { db } from "../drizzle";
import { sessionPacks, seatReservations, sessions } from "../../schema";
import type { SessionPackStatus } from "../../schema/sessionPacks";

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
) {
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
 * Get a session pack by ID
 * 
 * @param packId - UUID of the session pack
 * @returns Session pack or null if not found
 */
export async function getSessionPackById(packId: string) {
  const [pack] = await db
    .select()
    .from(sessionPacks)
    .where(eq(sessionPacks.id, packId))
    .limit(1);

  return pack || null;
}

/**
 * Get all active session packs for a user
 * 
 * @param userId - Clerk user ID
 * @returns Array of active session packs
 */
export async function getUserActiveSessionPacks(userId: string) {
  const packs = await db
    .select()
    .from(sessionPacks)
    .where(
      and(
        eq(sessionPacks.userId, userId),
        eq(sessionPacks.status, "active")
      )
    );

  return packs;
}

/**
 * Decrement remaining sessions for a pack
 * 
 * @param packId - UUID of the session pack
 * @returns Updated session pack
 */
export async function decrementRemainingSessions(packId: string) {
  const [pack] = await db
    .update(sessionPacks)
    .set({
      remainingSessions: sql`${sessionPacks.remainingSessions} - 1`,
      updatedAt: new Date(),
    })
    .where(eq(sessionPacks.id, packId))
    .returning();

  if (!pack) {
    throw new Error(`Session pack ${packId} not found`);
  }

  // Update status if depleted
  if (pack.remainingSessions <= 0) {
    await db
      .update(sessionPacks)
      .set({
        status: "depleted",
        updatedAt: new Date(),
      })
      .where(eq(sessionPacks.id, packId));
  }

  return pack;
}

/**
 * Increment remaining sessions for a pack (e.g., on cancellation)
 * 
 * @param packId - UUID of the session pack
 * @returns Updated session pack
 */
export async function incrementRemainingSessions(packId: string) {
  const [pack] = await db
    .update(sessionPacks)
    .set({
      remainingSessions: sql`${sessionPacks.remainingSessions} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(sessionPacks.id, packId))
    .returning();

  if (!pack) {
    throw new Error(`Session pack ${packId} not found`);
  }

  // Update status back to active if it was depleted
  if (pack.status === "depleted" && pack.remainingSessions > 0) {
    await db
      .update(sessionPacks)
      .set({
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(sessionPacks.id, packId));
  }

  return pack;
}

/**
 * Update session pack status
 * 
 * @param packId - UUID of the session pack
 * @param status - New status
 * @returns Updated session pack
 */
export async function updateSessionPackStatus(
  packId: string,
  status: SessionPackStatus
) {
  const [pack] = await db
    .update(sessionPacks)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(sessionPacks.id, packId))
    .returning();

  if (!pack) {
    throw new Error(`Session pack ${packId} not found`);
  }

  return pack;
}

