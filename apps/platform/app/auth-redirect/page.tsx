import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

/**
 * Handles post-sign-in routing based on user role.
 * Redirects admins to /admin and other users to /dashboard.
 */
export default async function AuthRedirectPage() {
  const { userId, sessionClaims } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const role = (sessionClaims?.publicMetadata as { role?: string })?.role ?? "student";

  if (role === "admin") {
    redirect("/admin");
  }

  redirect("/dashboard");
}