import { redirect } from "next/navigation";
import { requireRole, UnauthorizedError } from "@/lib/auth";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { ErrorBoundary } from "@/components/admin/error-boundary";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  try {
    await requireRole("admin");
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/sign-in");
    }
    throw error;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <AdminSidebar />
        <main className="flex-1 p-8">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
