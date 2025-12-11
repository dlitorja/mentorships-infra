import { eq, and, sql, count, or, inArray } from "drizzle-orm";
import { db } from "../drizzle";
import { seatReservations, mentors, sessionPacks, sessions } from "../../schema";
import type { SeatStatus } from "../../schema/seatReservations";

/**
 * Grace period duration in milliseconds (72 hours)
 */
const GRACE_PERIOD_MS = 72 * 60 * 60 * 1000;

/**
 * Reserve a seat for a student with a mentor
 * 
 * @param mentorId - UUID of the mentor
 * @param userId - Clerk user ID of the student
 * @param sessionPackId - UUID of the session pack
 * @param seatExpiresAt - When the seat expires (typically when pack expires)
 * @returns Created seat reservation
 */
export async function reserveSeat(
  mentorId: string,
  userId: string,
  sessionPackId: string,
  seatExpiresAt: Date
) {
  // Check if seat already exists for this pack
  const [existing] = await db
    .select()
    .from(seatReservations)
    .where(
      and(
        eq(seatReservations.sessionPackId, sessionPackId),
        eq(seatReservations.mentorId, mentorId),
        eq(seatReservations.userId, userId)
      )
    )
    .limit(1);

  if (existing) {
    // If seat exists but is released, reactivate it
    if (existing.status === "released") {
      const [updated] = await db
        .update(seatReservations)
        .set({
          status: "active",
          seatExpiresAt,
          gracePeriodEndsAt: null,
          updatedAt: new Date(),
        })
        .where(eq(seatReservations.id, existing.id))
        .returning();

      return updated;
    }

    // Otherwise return existing active/grace seat
    return existing;
  }

  // Create new seat reservation
  const [seat] = await db
    .insert(seatReservations)
    .values({
      mentorId,
      userId,
      sessionPackId,
      seatExpiresAt,
      status: "active",
    })
    .returning();

  return seat;
}

/**
 * Check if a mentor has available seats
 * 
 * @param mentorId - UUID of the mentor
 * @returns Object with availability info
 */
export async function checkSeatAvailability(mentorId: string): Promise<{
  available: boolean;
  activeSeats: number;
  maxSeats: number;
  remainingSeats: number;
}> {
  // Get mentor's max active students
  const [mentor] = await db
    .select({ maxActiveStudents: mentors.maxActiveStudents })
    .from(mentors)
    .where(eq(mentors.id, mentorId))
    .limit(1);

  if (!mentor) {
    throw new Error(`Mentor ${mentorId} not found`);
  }

  // Count active seats (active or grace status)
  const [activeSeatsResult] = await db
    .select({ count: count() })
    .from(seatReservations)
    .where(
      and(
        eq(seatReservations.mentorId, mentorId),
        inArray(seatReservations.status, ["active", "grace"])
      )
    );

  const activeSeats = Number(activeSeatsResult?.count ?? 0);
  const maxSeats = mentor.maxActiveStudents;
  const remainingSeats = Math.max(0, maxSeats - activeSeats);

  return {
    available: remainingSeats > 0,
    activeSeats,
    maxSeats,
    remainingSeats,
  };
}

/**
 * Release a seat reservation
 * 
 * @param seatId - UUID of the seat reservation
 * @returns Updated seat reservation
 */
export async function releaseSeat(seatId: string) {
  const [seat] = await db
    .update(seatReservations)
    .set({
      status: "released",
      updatedAt: new Date(),
    })
    .where(eq(seatReservations.id, seatId))
    .returning();

  if (!seat) {
    throw new Error(`Seat reservation ${seatId} not found`);
  }

  return seat;
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
 * Handle grace period for a seat reservation
 * 
 * Starts grace period when session 4 is completed (remaining_sessions = 0).
 * Grace period lasts 72 hours.
 * 
 * @param sessionPackId - UUID of the session pack
 * @returns Updated seat reservation with grace period
 */
export async function handleGracePeriod(sessionPackId: string) {
  // Get the seat reservation
  const [seat] = await db
    .select()
    .from(seatReservations)
    .where(eq(seatReservations.sessionPackId, sessionPackId))
    .limit(1);

  if (!seat) {
    throw new Error(`Seat reservation for pack ${sessionPackId} not found`);
  }

  // Get the session pack to check remaining sessions
  const [pack] = await db
    .select({ remainingSessions: sessionPacks.remainingSessions })
    .from(sessionPacks)
    .where(eq(sessionPacks.id, sessionPackId))
    .limit(1);

  if (!pack) {
    throw new Error(`Session pack ${sessionPackId} not found`);
  }

  // If remaining sessions are 0, start grace period
  if (pack.remainingSessions === 0 && seat.status === "active") {
    const gracePeriodEndsAt = new Date(Date.now() + GRACE_PERIOD_MS);

    const [updated] = await db
      .update(seatReservations)
      .set({
        status: "grace",
        gracePeriodEndsAt,
        updatedAt: new Date(),
      })
      .where(eq(seatReservations.id, seat.id))
      .returning();

    return updated;
  }

  return seat;
}

/**
 * Check if grace period has expired and release seat if needed
 * 
 * @param seatId - UUID of the seat reservation
 * @returns True if seat was released, false otherwise
 */
export async function checkAndReleaseExpiredGracePeriod(seatId: string): Promise<boolean> {
  const [seat] = await db
    .select()
    .from(seatReservations)
    .where(eq(seatReservations.id, seatId))
    .limit(1);

  if (!seat || seat.status !== "grace") {
    return false;
  }

  if (!seat.gracePeriodEndsAt) {
    return false;
  }

  const now = new Date();
  if (new Date(seat.gracePeriodEndsAt) < now) {
    // Grace period expired, release the seat
    await releaseSeat(seatId);
    return true;
  }

  return false;
}

/**
 * Get seat reservation by session pack ID
 * 
 * @param sessionPackId - UUID of the session pack
 * @returns Seat reservation or null if not found
 */
export async function getSeatByPackId(sessionPackId: string) {
  const [seat] = await db
    .select()
    .from(seatReservations)
    .where(eq(seatReservations.sessionPackId, sessionPackId))
    .limit(1);

  return seat || null;
}

/**
 * Get seat reservation by ID
 * 
 * @param seatId - UUID of the seat reservation
 * @returns Seat reservation or null if not found
 */
export async function getSeatById(seatId: string) {
  const [seat] = await db
    .select()
    .from(seatReservations)
    .where(eq(seatReservations.id, seatId))
    .limit(1);

  return seat || null;
}

/**
 * Check if seat can be used for booking
 * 
 * Seat can be used if status is "active"
 * Grace status means booking is disabled but seat is still held
 * 
 * @param seatId - UUID of the seat reservation
 * @returns True if seat is active and can be used for booking
 */
export async function canUseSeatForBooking(seatId: string): Promise<boolean> {
  const seat = await getSeatById(seatId);
  
  if (!seat) {
    return false;
  }

  // Check if grace period has expired
  if (seat.status === "grace" && seat.gracePeriodEndsAt) {
    const now = new Date();
    if (new Date(seat.gracePeriodEndsAt) < now) {
      // Grace expired, seat should be released (but we'll do that separately)
      return false;
    }
  }

  // Check if seat expiration has passed
  const now = new Date();
  if (new Date(seat.seatExpiresAt) < now) {
    // Check if there are scheduled sessions that should complete
    const [scheduledSessions] = await db
      .select({ count: sql<number>`count(*)` })
      .from(sessions)
      .where(
        and(
          eq(sessions.sessionPackId, seat.sessionPackId),
          eq(sessions.status, "scheduled")
        )
      );

    const scheduledCount = Number(scheduledSessions?.count ?? 0);
    
    // If no scheduled sessions, seat should be released
    if (scheduledCount === 0) {
      return false;
    }
  }

  return seat.status === "active";
}

/**
 * Get all active seats for a mentor
 * 
 * @param mentorId - UUID of the mentor
 * @returns Array of active seat reservations
 */
export async function getMentorActiveSeats(mentorId: string) {
  const seats = await db
    .select()
    .from(seatReservations)
    .where(
      and(
        eq(seatReservations.mentorId, mentorId),
        inArray(seatReservations.status, ["active", "grace"])
      )
    );

  return seats;
}

