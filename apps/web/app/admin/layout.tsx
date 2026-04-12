import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getDbUser } from "@/lib/auth";
import { ClientAdminLayout } from "./client-admin-layout";

export const dynamic = "force-dynamic";

async function checkAdminAccess() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/admin");
  }
  
  try {
    const user = await getDbUser();
    if (user.role !== "admin") {
      redirect("/dashboard?error=unauthorized");
    }
    return user;
  } catch {
    redirect("/sign-in?redirect_url=/admin");
  }
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await checkAdminAccess();

  return <ClientAdminLayout>{children}</ClientAdminLayout>;
}