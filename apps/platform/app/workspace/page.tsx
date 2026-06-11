import { requireAuth } from "@/lib/auth";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import WorkspaceClientPage from "@/components/workspace/workspace-client-page";
import { Loader2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const isBuildTime = !clerkKey || clerkKey.includes("placeholder");

  if (isBuildTime) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const clerkUserId = await requireAuth();

  return (
    <ProtectedLayout currentPath="/workspace">
      <WorkspaceClientPage clerkUserId={clerkUserId} />
    </ProtectedLayout>
  );
}