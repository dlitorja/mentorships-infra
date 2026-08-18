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