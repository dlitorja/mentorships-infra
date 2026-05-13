import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { requireDbUser } from "@/lib/auth";
import { ClientAdminLayout } from "./client-admin-layout";

export const dynamic = "force-dynamic";

async function checkAdminAccess(): Promise<void> {
  const { userId } = await auth();
  if (!userId) {
    redirect("/admin/sign-in");
  }
  
  const user = await requireDbUser();
  if (user.role !== "admin") {
    redirect("/dashboard?error=unauthorized");
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