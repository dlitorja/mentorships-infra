import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export class UnauthorizedError extends Error {
  constructor(message: string = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

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
