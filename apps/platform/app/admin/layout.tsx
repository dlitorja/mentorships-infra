import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { ClientAdminLayout } from "./client-admin-layout";

export const dynamic = "force-dynamic";

async function checkAdminAccess(): Promise<void> {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/admin");
  }
  
  const role = (sessionClaims?.publicMetadata as any)?.role as string || "student";
  if (role !== "admin") {
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