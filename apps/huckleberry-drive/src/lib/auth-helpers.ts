import { auth } from "@clerk/nextjs/server";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";

export type UserRole = "admin" | "instructor" | "student" | "video_editor";

export async function getServerUserRole(userId: string): Promise<UserRole> {
  try {
    const convex = getConvexClient();
    const user = await convex.query(api.users.getCurrentUser, {});
    if (user?.role && ["admin", "instructor", "student", "video_editor"].includes(user.role)) {
      return user.role as UserRole;
    }
  } catch {
    // Fall through to default
  }
  return "student";
}

export async function requireAuth() {
  const { userId } = await auth();
  if (!userId) {
    throw new UnauthorizedError("Unauthorized");
  }
  return userId;
}

export async function requireRoleForApi(requiredRole: "admin" | "instructor") {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    throw new UnauthorizedError("Unauthorized");
  }

  const claimsRole = (sessionClaims?.publicMetadata as Record<string, unknown> | undefined)?.role;
  const role: UserRole =
    typeof claimsRole === "string" && ["admin", "instructor", "student", "video_editor"].includes(claimsRole)
      ? (claimsRole as UserRole)
      : await getServerUserRole(userId);

  if (requiredRole === "admin" && role !== "admin") {
    throw new ForbiddenError("Admin role required");
  }

  if (requiredRole === "instructor" && role !== "instructor" && role !== "admin" && role !== "video_editor") {
    throw new ForbiddenError("Instructor role required");
  }

  return { id: userId, role };
}

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}