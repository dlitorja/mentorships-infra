import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { UnauthorizedError } from "@/lib/auth";
import { ClientAdminLayout } from "./client-admin-layout";

export const dynamic = "force-dynamic";

const KNOWN_ROLES = ["admin", "instructor", "student", "support"] as const;
type KnownRole = (typeof KNOWN_ROLES)[number];

function isKnownRole(value: unknown): value is KnownRole {
  return typeof value === "string" && (KNOWN_ROLES as readonly string[]).includes(value);
}

async function resolveAdminRole(userId: string): Promise<boolean> {
  const { sessionClaims } = await auth();
  const claimsRole = (sessionClaims?.publicMetadata as Record<string, unknown> | undefined)?.role;
  if (claimsRole === "admin") return true;
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    if (isKnownRole(user.publicMetadata?.role) && user.publicMetadata?.role === "admin") {
      return true;
    }
  } catch {
    // Fall through; default deny.
  }
  return false;
}

async function checkAdminAccess(): Promise<void> {
  const { userId } = await auth();
  if (!userId) {
    throw new UnauthorizedError("Unauthorized");
  }
  const isAdmin = await resolveAdminRole(userId);
  if (!isAdmin) {
    redirect("/?error=unauthorized");
  }
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  try {
    await checkAdminAccess();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/sign-in");
    }
    throw error;
  }

  return <ClientAdminLayout>{children}</ClientAdminLayout>;
}
