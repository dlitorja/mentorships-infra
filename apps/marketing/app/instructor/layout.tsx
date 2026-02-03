import { ErrorBoundary } from "@/components/admin/error-boundary";

export default function InstructorLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="container mx-auto p-4 md:p-8">
      <ErrorBoundary>{children}</ErrorBoundary>
    </div>
  );
}
