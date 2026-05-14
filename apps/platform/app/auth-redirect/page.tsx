import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function AuthRedirectPage(): Promise<never> {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  let role: string = "student";
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const metadataRole = user.publicMetadata?.role;
    if (typeof metadataRole === "string" && ["admin", "instructor", "student"].includes(metadataRole)) {
      role = metadataRole;
    }
  } catch {
    // Default to student on Clerk API failure
  }

  if (role === "admin") {
    redirect("/admin");
  }

  redirect("/dashboard");
}