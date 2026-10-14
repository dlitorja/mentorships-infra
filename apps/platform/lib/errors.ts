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
export function isArchivedWorkspaceBookingError(
  error: unknown
): error is Error & { data: { code: string; message: string } } {
  if (error instanceof Error) {
    // Convex client surfaces ConvexError subclasses with their data
    // attached at `.data`. Use the message as a fallback so we also
    // recognise older logs where the code may not have propagated.
    const data = (error as unknown as { data?: { code?: string } }).data;
    if (data?.code === "WORKSPACE_ARCHIVED_FOR_BOOKING") return true;
    if (typeof error.message === "string" &&
        error.message.includes("WORKSPACE_ARCHIVED_FOR_BOOKING")) {
      return true;
    }
  }
  return false;
}
