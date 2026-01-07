import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export const ADMIN_EMAIL = "admin@huckleberry.art";

export async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/admin/signin");
  }

  const user = await currentUser();
  const isAdmin = user?.emailAddresses?.[0]?.emailAddress === ADMIN_EMAIL;

  if (!isAdmin) {
    throw new Error("Forbidden: Admin access required");
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
  return user.emailAddresses?.[0]?.emailAddress === ADMIN_EMAIL;
}
