import { eq, and } from "drizzle-orm";
import { db } from "../drizzle";
import { sessionPacks, seatReservations } from "../../schema";

type SessionPack = typeof sessionPacks.$inferSelect;
type SeatReservation = typeof seatReservations.$inferSelect;

export type BookingValidationResult =
  | { valid: true }
  | {
      valid: false;
      error: string;
      errorCode:
        | "PACK_NOT_FOUND"
        | "PACK_EXPIRED"
        | "PACK_DEPLETED"
        | "SCHEDULED_AFTER_EXPIRATION"
        | "NO_REMAINING_SESSIONS"
        | "SEAT_NOT_ACTIVE"
        | "PACK_NOT_ACTIVE";
    };

/**
 * Validate that a session pack is eligible for booking
 * Checks:
 * - Pack exists
 * - Pack is active (not depleted, expired, or refunded)
 * - Pack has not expired
 * - Pack has remaining sessions > 0
 * - Seat reservation is active
 *
 * @param packId - Session pack ID to validate
 * @param userId - User ID to verify ownership
 * @returns Validation result with error details if invalid
 */
export async function validateBookingEligibility(
  packId: string,
  userId: string,
  scheduledAt?: Date
): Promise<BookingValidationResult> {
  // Get session pack with seat reservation
  const { pack, seat } = await getPackWithSeat(packId, userId);

  if (!pack) {
    return {
      valid: false,
      error: "Session pack not found or you don't have access to it",
      errorCode: "PACK_NOT_FOUND",
    };
  }

  const now = new Date();

  // Check if pack is expired (before status check to prevent race conditions)
  if (pack.expiresAt < now) {
    return {
      valid: false,
      error: "Session pack has expired. Bookings are no longer allowed.",
      errorCode: "PACK_EXPIRED",
    };
  }

  // Check if the desired scheduled time exceeds the pack expiration
  if (scheduledAt && new Date(scheduledAt) > new Date(pack.expiresAt)) {
    return {
      valid: false,
      error: "Session cannot be scheduled after the pack expires.",
      errorCode: "SCHEDULED_AFTER_EXPIRATION",
    };
  }

  // Check pack status
  if (pack.status !== "active") {
    return {
      valid: false,
      error: `Session pack is ${pack.status}. Bookings are not allowed.`,
      errorCode: "PACK_NOT_ACTIVE",
    };
  }

  // Check remaining sessions
  if (pack.remainingSessions <= 0) {
    return {
      valid: false,
      error: "No remaining sessions available. Please renew your pack.",
      errorCode: "NO_REMAINING_SESSIONS",
    };
  }

  // Check seat reservation status
  if (!seat) {
    return {
      valid: false,
      error: "Seat reservation not found. Please contact support.",
      errorCode: "SEAT_NOT_ACTIVE",
    };
  }

  if (seat.status !== "active") {
    return {
      valid: false,
      error: `Seat is ${seat.status}. Bookings are not allowed.`,
      errorCode: "SEAT_NOT_ACTIVE",
    };
  }

  return { valid: true };
}

/**
 * Get session pack and seat reservation for validation
 * This is a helper to fetch both in one query
 */
export async function getPackWithSeat(
  packId: string,
  userId: string
): Promise<{
  pack: SessionPack | null;
  seat: SeatReservation | null;
}> {
  const result = await db
    .select({
      pack: sessionPacks,
      seat: seatReservations,
    })
    .from(sessionPacks)
    .leftJoin(
      seatReservations,
      eq(seatReservations.sessionPackId, sessionPacks.id)
    )
    .where(
      and(
        eq(sessionPacks.id, packId),
        eq(sessionPacks.userId, userId)
      )
    )
    .limit(1);

  if (result.length === 0) {
    return { pack: null, seat: null };
  }

  return {
    pack: result[0]?.pack || null,
    seat: result[0]?.seat || null,
  };
}

