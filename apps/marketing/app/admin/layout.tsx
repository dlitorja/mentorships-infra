import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { UnauthorizedError, isAdminUser } from "@/lib/auth";
import { ClientAdminLayout } from "./client-admin-layout";

export const dynamic = "force-dynamic";

async function checkAdminAccess(): Promise<void> {
  const { userId } = await auth();
  if (!userId) {
    throw new UnauthorizedError("Unauthorized");
  }
  if (!(await isAdminUser())) {
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
