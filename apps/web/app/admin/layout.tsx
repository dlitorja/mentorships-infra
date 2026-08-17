import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { requireDbUser, UnauthorizedError, isUnauthorizedError } from "@/lib/auth";
import { ClientAdminLayout } from "./client-admin-layout";

export const dynamic = "force-dynamic";

async function checkAdminAccess(): Promise<void> {
  try {
    const { userId } = await auth();
    if (!userId) {
      redirect("/admin/sign-in");
    }
    
    const user = await requireDbUser();
    if (user.role !== "admin") {
      redirect("/dashboard?error=unauthorized");
    }
  } catch (error) {
    if (isUnauthorizedError(error)) {
      redirect("/admin/sign-in");
    }
    throw error;
  }
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  await checkAdminAccess();

  return <ClientAdminLayout>{children}</ClientAdminLayout>;
}