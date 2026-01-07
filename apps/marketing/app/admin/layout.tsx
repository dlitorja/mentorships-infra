import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { ErrorBoundary } from "@/components/admin/error-boundary";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
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
