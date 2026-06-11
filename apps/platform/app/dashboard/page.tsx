import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { DashboardContent } from "./DashboardContent";

export const dynamic = "force-dynamic";

function DashboardLoading() {
  return (
    <div className="flex justify-center py-8">
      <Loader2 className="h-8 w-8 animate-spin" />
    </div>
  );
}

export default async function DashboardPage() {
  return (
    <ProtectedLayout currentPath="/dashboard">
      <div className="container mx-auto p-4 md:p-8">
        <Suspense fallback={<DashboardLoading />}>
          <DashboardContent />
        </Suspense>
      </div>
    </ProtectedLayout>
  );
}