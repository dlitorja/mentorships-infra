import { requireAuth } from "@/lib/auth";
import { getConvexAuthToken, getServerUserRole } from "@/lib/auth-helpers";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import WorkspaceClientPage from "@/components/workspace/workspace-client-page";
import { Loader2 } from "lucide-react";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import type { UserRole } from "@/lib/auth-helpers";

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
  const token = await getConvexAuthToken();
  const workspaces = await fetchQuery(api.workspaces.getUserWorkspaces, { ownerId: clerkUserId }, { token: token ?? undefined });
  const userRole: UserRole = await getServerUserRole(clerkUserId);

  return (
    <ProtectedLayout currentPath="/workspace">
      <WorkspaceClientPage clerkUserId={clerkUserId} workspaces={workspaces} userRole={userRole} />
    </ProtectedLayout>
  );
}