import { redirect } from "next/navigation";
import { getDbUser, UnauthorizedError } from "@/lib/auth";
import { ClientAdminLayout } from "./client-admin-layout";

export const dynamic = "force-dynamic";

async function checkAdminAccess(): Promise<void> {
  try {
    const user = await getDbUser();
    if (user.role !== "admin") {
      redirect("/dashboard?error=unauthorized");
    }
  } catch (error) {
    if (error instanceof UnauthorizedError) {
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