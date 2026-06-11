import { auth } from "@clerk/nextjs/server";
import { getServerUserRole } from "@/lib/auth-helpers";

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export function isUnauthorizedError(error: unknown): error is UnauthorizedError {
  return error instanceof UnauthorizedError;
}

export async function requireAuth() {
  const { userId } = await auth();
  if (!userId) {
    throw new UnauthorizedError();
  }
  return userId;
}

export async function getUser() {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }
  return { id: userId };
}

export type DbUser = {
  id: string;
  role: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  timeZone?: string;
};

export async function requireDbUser(): Promise<DbUser> {
  // Delegate to getDbUser to keep behavior consistent
  return getDbUser();
}

export async function getDbUser(): Promise<DbUser> {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    throw new UnauthorizedError();
  }
  // Fast path: use claims role when present; fallback to server API
  const claimsRole = (sessionClaims?.publicMetadata as Record<string, unknown> | undefined)?.role;
  const role =
    typeof claimsRole === "string" && ["admin", "instructor", "student"].includes(claimsRole)
      ? (claimsRole as string)
      : await getServerUserRole(userId);
  return { id: userId, role, timeZone: undefined };
}
