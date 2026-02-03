import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getOrCreateUser, UnauthorizedError, ForbiddenError, isUnauthorizedError, isForbiddenError } from "@mentorships/db";

const DEFAULT_ADMIN_EMAILS = ["admin@huckleberry.art"];

export function getAdminEmails(): string[] {
  const envValue = process.env.ADMIN_EMAILS;
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

export async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/admin/signin");
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

export async function getDbUser() {
  const userId = await getUserId();
  const user = await getOrCreateUser(userId);
  return user;
}

export async function requireDbUser() {
  const userId = await getUserId();
  const user = await getOrCreateUser(userId);
  return user;
}

export async function requireAuthRedirect() {
  const { userId } = await auth();
  
  if (!userId) {
    redirect("/sign-in");
  }
  
  return userId;
}

export async function hasRole(role: "student" | "mentor" | "admin") {
  const { userId } = await auth();
  if (!userId) return false;

  const user = await getDbUser();
  
  return user.role === role;
}

export async function requireRole(role: "student" | "mentor" | "admin") {
  const userId = await requireAuthRedirect();
  
  const user = await getDbUser();
  
  if (user.role !== role) {
    redirect("/dashboard?error=insufficient_permissions");
  }
  
  return user;
}

export async function requireRoleForApi(role: "student" | "mentor" | "admin") {
  const { userId } = await auth();
  
  if (!userId) {
    throw new UnauthorizedError("Authentication required");
  }
  
  const user = await getDbUser();
  
  if (user.role !== role) {
    throw new ForbiddenError(`Admin access required`);
  }
  
  return user;
}
