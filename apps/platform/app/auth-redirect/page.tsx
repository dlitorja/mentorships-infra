import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

interface SessionClaimsWithRole {
  publicMetadata?: {
    role?: string;
  };
}

function isSessionClaimsWithRole(
  obj: unknown
): obj is SessionClaimsWithRole {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "publicMetadata" in obj &&
    typeof (obj as SessionClaimsWithRole).publicMetadata === "object"
  );
}

/**
 * Handles post-sign-in routing based on user role.
 * Redirects admins to /admin and other users to /dashboard.
 */
export default async function AuthRedirectPage(): Promise<never> {
  const { userId, sessionClaims } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const role = isSessionClaimsWithRole(sessionClaims) &&
    typeof sessionClaims.publicMetadata?.role === "string"
    ? sessionClaims.publicMetadata.role
    : "student";

  if (role === "admin") {
    redirect("/admin");
  }

  redirect("/dashboard");
}