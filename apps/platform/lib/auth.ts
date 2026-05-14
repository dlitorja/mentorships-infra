import { auth, clerkClient } from "@clerk/nextjs/server";
import "server-only";

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

async function getServerUserRole(userId: string): Promise<string> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const role = user.publicMetadata?.role;
    if (typeof role === "string" && ["admin", "instructor", "student"].includes(role)) {
      return role;
    }
  } catch {
    // Fall through to default
  }
  return "student";
}

export async function requireDbUser(): Promise<DbUser> {
  const userId = await requireAuth();
  const role = await getServerUserRole(userId);
  return { id: userId, role, timeZone: undefined };
}

export async function getDbUser(): Promise<DbUser> {
  const { userId } = await auth();
  if (!userId) {
    throw new UnauthorizedError();
  }
  const role = await getServerUserRole(userId);
  return { id: userId, role, timeZone: undefined };
}