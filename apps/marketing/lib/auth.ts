import { auth, currentUser, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getOrCreateUser, UnauthorizedError, ForbiddenError, isUnauthorizedError, isForbiddenError } from "@mentorships/db";
import type { users } from "@mentorships/db";

export { UnauthorizedError, ForbiddenError, isUnauthorizedError, isForbiddenError };

export type DbUser = typeof users.$inferSelect;

const DEFAULT_ADMIN_EMAILS = ["admin@huckleberry.art"];

export function getAdminEmails(): string[] {
  // MARKETING_ADMIN_EMAILS (preferred) and ADMIN_EMAILS (legacy) must stay
  // in sync with convex/waitlist.ts:isAdminUser, which reads the same two
  // vars so the marketing route and the Convex boundary agree on the
  // allowlist precedence. MARKETING_ADMIN_EMAILS takes precedence; this
  // matches the Convex-side resolver.
  const envValue =
    process.env.MARKETING_ADMIN_EMAILS ?? process.env.ADMIN_EMAILS;
  if (!envValue || envValue.trim() === "") {
    return DEFAULT_ADMIN_EMAILS;
  }
  return envValue.split(",").map((email) => email.trim()).filter(Boolean);
}

function getPrimaryEmail(user: Awaited<ReturnType<typeof currentUser>>): string | null {
  if (!user?.emailAddresses?.length) return null;

  const primary = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId);
  if (primary) return primary.emailAddress;

  return user.emailAddresses[0]?.emailAddress ?? null;
}

const KNOWN_ROLES = ["admin", "instructor", "student", "support"] as const;
type KnownRole = (typeof KNOWN_ROLES)[number];

function isKnownRole(value: unknown): value is KnownRole {
  return typeof value === "string" && (KNOWN_ROLES as readonly string[]).includes(value);
}

/**
 * Resolves the current user's effective role. Uses Clerk session claims as a
 * fast path, then falls back to the Clerk Backend API for the canonical
 * `publicMetadata.role` if the JWT has not yet picked up a recent role
 * change. Always use this — never read role from Supabase `users.role`
 * because the production column type mismatch (`text` vs `uuid`) makes
 * instructor lookups fail.
 */
export async function resolveUserRole(): Promise<KnownRole | null> {
  const { userId, sessionClaims } = await auth();
  if (!userId) return null;
  const claimsRole = (sessionClaims?.publicMetadata as Record<string, unknown> | undefined)?.role;
  if (isKnownRole(claimsRole)) {
    return claimsRole;
  }
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const metadataRole = user.publicMetadata?.role;
    if (isKnownRole(metadataRole)) {
      return metadataRole;
    }
  } catch {
    // Fall through; default deny.
  }
  return null;
}

export async function isAdminUser(): Promise<boolean> {
  return (await resolveUserRole()) === "admin";
}

export async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/admin/signin");
  }

  if (await isAdminUser()) {
    return userId;
  }

  const user = await currentUser();
  const adminEmails = getAdminEmails();
  const userEmail = getPrimaryEmail(user);
  const isAdmin = userEmail ? adminEmails.includes(userEmail) : false;

  if (!isAdmin) {
    throw new UnauthorizedError("Admin access required");
  }

  return userId;
}

export async function getCurrentUser() {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }

  return currentUser();
}

export function isAdmin(user: Awaited<ReturnType<typeof currentUser>>): boolean {
  if (!user) return false;
  const adminEmails = getAdminEmails();
  const userEmail = getPrimaryEmail(user);
  return userEmail ? adminEmails.includes(userEmail) : false;
}

export async function getUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) {
    throw new UnauthorizedError("Not authenticated");
  }
  return userId;
}

export async function getUser() {
  return currentUser();
}

export async function requireAuth() {
  const { userId } = await auth();
  if (!userId) {
    throw new UnauthorizedError("Not authenticated");
  }
  return userId;
}

export async function getDbUser(): Promise<DbUser> {
  const user = await getOrCreateUser();
  if (!user) {
    throw new UnauthorizedError("User not found in database");
  }
  return user;
}

export async function requireDbUser(): Promise<DbUser> {
  return getDbUser();
}

export async function requireAuthRedirect() {
  const { userId } = await auth();
  
  if (!userId) {
    redirect("/sign-in");
  }
  
  return userId;
}

export async function hasRole(role: "student" | "instructor" | "admin"): Promise<boolean> {
  const { userId } = await auth();
  if (!userId) return false;

  const user = await getDbUser();
  
  return user?.role === role;
}

export async function requireRole(role: "student" | "instructor" | "admin"): Promise<DbUser> {
  const userId = await requireAuthRedirect();
  
  const user = await getDbUser();
  
  if (user.role !== role) {
    redirect("/dashboard?error=insufficient_permissions");
  }
  
  return user;
}

export async function requireRoleForApi(role: "student" | "instructor" | "admin"): Promise<DbUser> {
  const { userId } = await auth();
  
  if (!userId) {
    throw new UnauthorizedError("Authentication required");
  }
  
  const user = await getDbUser();
  
  if (user.role !== role) {
    throw new ForbiddenError(`${role} access required`);
  }
  
  return user;
}
