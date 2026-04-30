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
  return error instanceof UnauthorizedError;
}

export function isForbiddenError(error: unknown): error is ForbiddenError {
  return error instanceof ForbiddenError;
}