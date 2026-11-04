import { expect, test } from "vitest";
import * as seatReservations from "./seatReservations";

/**
 * Wave 3a (HUC-117) regression guard — seat writers.
 *
 * These mutations were public and unauthenticated: anyone with the Convex
 * deployment URL could release/extend/delete seats and end workspaces. They
 * are now internal; the only production create path is the bearer
 * `/seat-reservations/create` endpoint used by the payment workers.
 */

type Visibility = { isInternal?: boolean; isPublic?: boolean };

const INTERNAL_ONLY: ReadonlyArray<readonly [string, Visibility]> = [
  ["createSeatReservation", seatReservations.createSeatReservation as Visibility],
  ["updateSeatReservation", seatReservations.updateSeatReservation as Visibility],
  ["releaseSeat", seatReservations.releaseSeat as Visibility],
  ["extendSeat", seatReservations.extendSeat as Visibility],
  ["deleteSeatReservation", seatReservations.deleteSeatReservation as Visibility],
  ["processExpiredSeats", seatReservations.processExpiredSeats as Visibility],
  ["releaseSeatById", seatReservations.releaseSeatById as Visibility],
];

test("wave 3a seat writers are internal-only", () => {
  for (const [functionName, visibility] of INTERNAL_ONLY) {
    expect(visibility.isInternal, `seatReservations.${functionName} must be internalMutation`).toBe(true);
    expect(visibility.isPublic, `seatReservations.${functionName} must not be public`).not.toBe(true);
  }
});
