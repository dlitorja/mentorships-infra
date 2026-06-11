import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function AuthRedirectPage(): Promise<never> {
  const { userId, sessionClaims } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  // Fast path: prefer role from session claims to avoid Clerk API latency
  const claimsRole = (sessionClaims?.publicMetadata as Record<string, unknown> | undefined)?.role;
  let role: string | undefined =
    typeof claimsRole === "string" && ["admin", "instructor", "student"].includes(claimsRole)
      ? claimsRole
      : undefined;

  // Fallback: query Clerk only when the claim isn't present
  if (!role) {
    try {
      const client = await clerkClient();
      const user = await client.users.getUser(userId);
      const metadataRole = user.publicMetadata?.role;
      if (typeof metadataRole === "string" && ["admin", "instructor", "student"].includes(metadataRole)) {
        role = metadataRole;
      }
    } catch {
      // Default below
    }
  }
  if (!role) role = "student";

  if (role === "admin") {
    redirect("/admin");
  }
  if (role === "instructor") {
    redirect("/instructor/dashboard");
  }

  redirect("/dashboard");
}
