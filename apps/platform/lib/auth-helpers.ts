import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import "server-only";

export async function requireAuth() {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("Unauthorized");
  }
  return userId;
}

export async function requireRole(requiredRole: "admin" | "instructor" | "student") {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const role = (sessionClaims?.publicMetadata as any)?.role as string || "student";

  if (requiredRole === "admin" && role !== "admin") {
    throw new Error("Forbidden - Admin required");
  }

  if (requiredRole === "instructor" && role !== "instructor" && role !== "admin") {
    throw new Error("Forbidden - Instructor required");
  }

  return { id: userId, role };
}

export async function requireRoleForApi(requiredRole: "admin" | "instructor") {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const role = (sessionClaims?.publicMetadata as any)?.role as string || "student";

  if (requiredRole === "admin" && role !== "admin") {
    throw new Error("Forbidden - Admin required");
  }

  if (requiredRole === "instructor" && role !== "instructor" && role !== "admin") {
    throw new Error("Forbidden - Instructor required");
  }

  return { id: userId, role };
}