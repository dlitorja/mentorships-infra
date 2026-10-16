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
  // PR 12 PR E (Follow-up) — Greptile round-9 P2: pass the
  // server-side bypass decision down to the client
  // `<DashboardContent />` so the welcome card's hook is disabled
  // and the banner doesn't render mid-E2E. Mirrors the same env-
  // var short-circuit that `proxy.ts` and `<ProtectedLayout />`
  // use.
  const isTestWebhookBypass = process.env.TEST_WEBHOOK_BYPASS === "true";
  return (
    <ProtectedLayout currentPath="/dashboard">
      <div className="container mx-auto p-4 md:p-8">
        <Suspense fallback={<DashboardLoading />}>
          <DashboardContent isTestWebhookBypass={isTestWebhookBypass} />
        </Suspense>
      </div>
    </ProtectedLayout>
  );
}