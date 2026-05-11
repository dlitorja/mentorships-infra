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

export async function requireDbUser() {
  const userId = await requireAuth();
  return { id: userId, role: "student" } as { id: string; role: string };
}

export async function getDbUser() {
  const userId = await requireAuth();
  return { id: userId, role: "student" } as { id: string; role: string };
}