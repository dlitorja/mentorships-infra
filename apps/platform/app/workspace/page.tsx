import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getConvexAuthToken, getServerUserRole } from "@/lib/auth-helpers";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import WorkspaceClientPage from "@/components/workspace/workspace-client-page";
import { Loader2 } from "lucide-react";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { UserRole } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

/**
 * PR #4c-2: when the user has exactly one workspace, redirect to
 * the dynamic route `/workspace/{id}` so the deep-link from an
 * ad-hoc call notification lands them directly in their only
 * workspace (no picker step). With multiple workspaces, render the
 * picker as before so the user can choose.
 *
 * Single-workspace redirect is also what users expect after a
 * notification click — the bell says "join call in workspace X" and
 * the page should land them in workspace X, not show them a picker
 * for them to click X again.
 */
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
  const workspaces = await fetchQuery(
    api.workspaces.getUserWorkspaces,
    { ownerId: clerkUserId },
    { token: token ?? undefined }
  );

  if (workspaces && workspaces.length === 1) {
    redirect(`/workspace/${workspaces[0]._id}`);
  }

  // Only resolve the user role when we're actually rendering the
  // picker. The single-workspace redirect above avoids the
  // `getServerUserRole` call (a Clerk API lookup) entirely on the
  // hot path so the user lands in their workspace without the
  // extra round-trip.
  const userRole: UserRole = await getServerUserRole(clerkUserId);

  return (
    <ProtectedLayout currentPath="/workspace">
      <WorkspaceClientPage
        clerkUserId={clerkUserId}
        workspaces={workspaces}
        userRole={userRole}
      />
    </ProtectedLayout>
  );
}