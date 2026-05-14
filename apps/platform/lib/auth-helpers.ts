import { auth, clerkClient } from "@clerk/nextjs/server";
import "server-only";

export type UserRole = "admin" | "instructor" | "student";

export async function getServerUserRole(userId: string): Promise<UserRole> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const role = user.publicMetadata?.role;
    if (typeof role === "string" && ["admin", "instructor", "student"].includes(role)) {
      return role as UserRole;
    }
  } catch {
    // Fall through to default
  }
  return "student";
}

export async function requireAuth() {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("Unauthorized");
  }
  return userId;
}

export async function requireRole(requiredRole: "admin" | "instructor" | "student") {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const role = await getServerUserRole(userId);

  if (requiredRole === "admin" && role !== "admin") {
    throw new Error("Forbidden - Admin required");
  }

  if (requiredRole === "instructor" && role !== "instructor" && role !== "admin") {
    throw new Error("Forbidden - Instructor required");
  }

  return { id: userId, role };
}

export async function requireRoleForApi(requiredRole: "admin" | "instructor") {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const role = await getServerUserRole(userId);

  if (requiredRole === "admin" && role !== "admin") {
    throw new Error("Forbidden - Admin required");
  }

  if (requiredRole === "instructor" && role !== "instructor" && role !== "admin") {
    throw new Error("Forbidden - Instructor required");
  }

  return { id: userId, role };
}