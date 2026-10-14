export class UnauthorizedError extends Error {
  readonly code = "UNAUTHORIZED" as const;
  readonly statusCode = 401 as const;

  constructor(message: string = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN" as const;
  readonly statusCode = 403 as const;

  constructor(message: string = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

export function isUnauthorizedError(error: unknown): error is UnauthorizedError {
  if (error instanceof UnauthorizedError) return true;
  if (error instanceof Error) {
    const msg = error.message;
    return msg === "Unauthorized" || msg === "Authentication required" || msg === "No auth token";
  }
  return false;
}

export function isForbiddenError(error: unknown): error is ForbiddenError {
  if (error instanceof ForbiddenError) return true;
  if (error instanceof Error) {
    const msg = error.message;
    return msg === "Forbidden" || msg === "Admin role required" || msg === "Forbidden: Admin role required";
  }
  return false;
}

/**
 * PR-C (Greptile round-7 P2): the calendar-booking guard in
 * `convex/bookings.createPending` throws a `ConvexError` with
 * `code: "WORKSPACE_ARCHIVED_FOR_BOOKING"` whenever the caller has
 * only archived / ended mentorship workspaces with the instructor.
 * The HTTP booking routes must surface this as a friendly 409
 * instead of letting it bubble up as a generic 500
 * \u2014 the student needs to know to **unarchive** the workspace
 * before they can book again. The shape `{ code, message }` matches
 * the pattern already used by other Convex throws
 * (e.g. `VIDEO_SESSION_NOT_FOUND` in `sessions.ts`).
 */
/**
 * PR-C (Greptile round-7 P2 + round-8 P2): the calendar-booking
 * guard in `convex/bookings.createPending` throws a typed
 * `ConvexError` whose `code` discriminates the shape of the
 * inactive-workspace state:
 *
 *   - WORKSPACE_ARCHIVED_FOR_BOOKING               \u2014 caller can unarchive
 *   - WORKSPACE_ENDED_FOR_BOOKING                  \u2014 caller must buy a new pack
 *   - WORKSPACE_ARCHIVED_AND_ENDED_FOR_BOOKING     \u2014 both: support / new pack
 *   - WORKSPACE_INACTIVE_FOR_BOOKING               \u2014 mixed; tail of pairs
 *
 * Routes use `isArchivedWorkspaceBookingError` to map ANY of the
 * four into a 409 with the friendly unarchive / new-pack copy that
 * the typed message already carries. They use
 * `getWorkspaceBookingErrorCode` to discriminate for finer-grained
 * UX (e.g. show a "Buy a new pack" CTA when code =
 * WORKSPACE_ENDED_FOR_BOOKING).
 */
export type WorkspaceBookingErrorCode =
  | "WORKSPACE_ARCHIVED_FOR_BOOKING"
  | "WORKSPACE_ENDED_FOR_BOOKING"
  | "WORKSPACE_ARCHIVED_AND_ENDED_FOR_BOOKING"
  | "WORKSPACE_INACTIVE_FOR_BOOKING";

const WORKSPACE_BOOKING_CODES: ReadonlyArray<WorkspaceBookingErrorCode> = [
  "WORKSPACE_ARCHIVED_FOR_BOOKING",
  "WORKSPACE_ENDED_FOR_BOOKING",
  "WORKSPACE_ARCHIVED_AND_ENDED_FOR_BOOKING",
  "WORKSPACE_INACTIVE_FOR_BOOKING",
];

export function isArchivedWorkspaceBookingError(
  error: unknown
): error is Error & { data: { code: WorkspaceBookingErrorCode; message: string } } {
  return getWorkspaceBookingErrorCode(error) !== null;
}

export function getWorkspaceBookingErrorCode(
  error: unknown
): WorkspaceBookingErrorCode | null {
  if (error instanceof Error) {
    const data = (error as unknown as { data?: { code?: string } }).data;
    if (
      typeof data?.code === "string" &&
      (WORKSPACE_BOOKING_CODES as ReadonlyArray<string>).includes(data.code)
    ) {
      return data.code as WorkspaceBookingErrorCode;
    }
    // Fallback: older logs / dev builds may stringise the code into
    // the message. Match the canonical prefix.
    if (typeof error.message === "string") {
      for (const code of WORKSPACE_BOOKING_CODES) {
        if (error.message.includes(code)) return code;
      }
    }
  }
  return null;
}
