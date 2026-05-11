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

export async function requireRoleForApi(requiredRole: "admin" | "instructor") {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = (sessionClaims?.publicMetadata?.role as string) || "student";

  if (requiredRole === "admin" && role !== "admin") {
    return NextResponse.json({ error: "Forbidden - Admin required" }, { status: 403 });
  }

  if (requiredRole === "instructor" && role !== "instructor" && role !== "admin") {
    return NextResponse.json({ error: "Forbidden - Instructor required" }, { status: 403 });
  }

  return { userId, role };
}