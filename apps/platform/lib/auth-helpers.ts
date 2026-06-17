import { auth, clerkClient } from "@clerk/nextjs/server";
import { reportError } from "@/lib/observability";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";

export type UserRole = "admin" | "instructor" | "student";

export async function getConvexAuthToken(): Promise<string | null> {
  const clerkAuth = await auth();
  return clerkAuth.getToken({ template: "convex" });
}

export async function getClerkUserEmail(userId: string): Promise<string | null> {
  try {
    const { sessionClaims } = await auth();
    const email = sessionClaims?.email;
    if (typeof email === "string" && email) {
      return email.toLowerCase();
    }
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const primaryEmail = user.emailAddresses.find(
      (e) => e.id === user.primaryEmailAddressId
    );
    return primaryEmail?.emailAddress.toLowerCase() ?? null;
  } catch (err) {
    console.error("[auth-helpers] Failed to get user email:", err);
    return null;
  }
}

export async function getServerUserRole(userId: string): Promise<UserRole> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const role = user.publicMetadata?.role;
    if (typeof role === "string" && ["admin", "instructor", "student"].includes(role)) {
      return role as UserRole;
    }
  } catch (err) {
    // Emit a warning so outages are observable; fall through to default.
    await reportError({
      source: "auth-helpers.getServerUserRole",
      error: err instanceof Error ? err : new Error(String(err)),
      level: "warn",
      message: "Failed to fetch user role from Clerk API, defaulting to 'student'",
      context: { userId },
    });
  }
  return "student";
}

export async function requireAuth() {
  const { userId } = await auth();
  if (!userId) {
    // Throw typed error so API routes can classify to 401
    throw new UnauthorizedError("Unauthorized");
  }
  return userId;
}

export async function requireRole(requiredRole: "admin" | "instructor" | "student") {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    // Throw typed error for consistent handling
    throw new UnauthorizedError("Unauthorized");
  }

  // Fast path: use claims role when present; fallback to server API
  const claimsRole = (sessionClaims?.publicMetadata as Record<string, unknown> | undefined)?.role;
  const role: UserRole =
    typeof claimsRole === "string" && ["admin", "instructor", "student"].includes(claimsRole)
      ? (claimsRole as UserRole)
      : await getServerUserRole(userId);

  if (requiredRole === "admin" && role !== "admin") {
    throw new ForbiddenError("Admin role required");
  }

  if (requiredRole === "instructor" && role !== "instructor" && role !== "admin") {
    throw new ForbiddenError("Instructor role required");
  }

  return { id: userId, role };
}

export async function requireRoleForApi(requiredRole: "admin" | "instructor") {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    // Typed error so API handlers return 401
    throw new UnauthorizedError("Unauthorized");
  }

  // Fast path: use claims role when present; fallback to server API
  const claimsRole = (sessionClaims?.publicMetadata as Record<string, unknown> | undefined)?.role;
  const role: UserRole =
    typeof claimsRole === "string" && ["admin", "instructor", "student"].includes(claimsRole)
      ? (claimsRole as UserRole)
      : await getServerUserRole(userId);

  if (requiredRole === "admin" && role !== "admin") {
    // Typed error so API handlers return 403
    throw new ForbiddenError("Admin role required");
  }

  if (requiredRole === "instructor" && role !== "instructor" && role !== "admin") {
    throw new ForbiddenError("Instructor role required");
  }

  return { id: userId, role };
}
