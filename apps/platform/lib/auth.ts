import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
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

export async function requireDbUser(): Promise<DbUser> {
  const userId = await requireAuth();
  return { id: userId, role: "student", timeZone: undefined };
}

export async function getDbUser(): Promise<DbUser> {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    throw new UnauthorizedError();
  }
  const metadata = sessionClaims?.publicMetadata as { role?: string } | undefined;
  const role = typeof metadata?.role === "string" ? metadata.role : "student";
  return { id: userId, role, timeZone: undefined };
}