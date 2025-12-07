import { eq, desc, sql } from "drizzle-orm";
import { db } from "../drizzle";
import { sessionPacks, seatReservations } from "../../schema";
import type { SessionPackStatus } from "../../schema/sessionPacks";

type SessionPack = typeof sessionPacks.$inferSelect;

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
  const [updated] = await db
    .update(sessionPacks)
    .set({
      status,
      remainingSessions: remainingSessions !== undefined ? remainingSessions : undefined,
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

  // Get total count
  const totalResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(sessionPacks)
    .where(eq(sessionPacks.userId, userId));

  const total = Number(totalResult[0]?.count || 0);

  // Get paginated items ordered by createdAt DESC (newest first)
  const items = await db
    .select()
    .from(sessionPacks)
    .where(eq(sessionPacks.userId, userId))
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

