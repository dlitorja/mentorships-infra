import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getConvexAuthToken, getServerUserRole } from "@/lib/auth-helpers";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import WorkspaceClientPage from "@/components/workspace/workspace-client-page";
import { IncomingCallMarker } from "@/components/notifications/incoming-call-marker";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { convexIdSchema } from "@/lib/validators";
import { Loader2 } from "lucide-react";
import type { UserRole } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

interface WorkspaceIdPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ join?: string }>;
}

/**
 * PR #4c-2: deep-link route for ad-hoc call notifications.
 *
 * URL shape: `/workspace/{workspaceId}?join={sessionId}`. The
 * `?join={sessionId}` query param drives `WorkspaceClientPage` to
 * attempt an auto-join once the page mounts.
 *
 * Auth gate (server-side): `getWorkspaceByIdForUser` returns `null`
 * if the caller is not a participant on the workspace OR the
 * workspace is soft-deleted/ended. We redirect to `/workspace`
 * (the picker) in that case rather than 404 — same UX as
 * `getUserWorkspaces` filtering out deleted workspaces.
 *
 * Build-time guard matches the existing `/workspace/page.tsx` so
 * the static export does not crash when `NEXT_PUBLIC_CLERK_*` is
 * a placeholder during prebuild.
 */
export default async function WorkspaceIdPage({
  params,
  searchParams,
}: WorkspaceIdPageProps) {
  const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const isBuildTime = !clerkKey || clerkKey.includes("placeholder");

  if (isBuildTime) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { id } = await params;
  const { join } = await searchParams;

  if (!convexIdSchema.safeParse(id).success) {
    redirect("/workspace");
  }
  const workspaceId = id as Id<"workspaces">;

  await requireAuth();
  const token = await getConvexAuthToken();

  const workspace = await fetchQuery(
    api.workspaces.getWorkspaceByIdForUser,
    { id: workspaceId },
    { token: token ?? undefined }
  );

  if (!workspace) {
    redirect("/workspace");
  }

  const clerkUserId = await requireAuth();
  const userRole: UserRole = await getServerUserRole(clerkUserId);

  const joinSessionId =
    typeof join === "string" && convexIdSchema.safeParse(join).success
      ? (join as Id<"sessions">)
      : undefined;

  return (
    <ProtectedLayout currentPath="/workspace">
      <WorkspaceClientPage
        clerkUserId={clerkUserId}
        workspaces={[workspace]}
        userRole={userRole}
        initialWorkspaceId={workspaceId}
        initialJoinSessionId={joinSessionId}
      />
      {joinSessionId && (
        <IncomingCallMarker initialJoinSessionId={joinSessionId} />
      )}
    </ProtectedLayout>
  );
}
