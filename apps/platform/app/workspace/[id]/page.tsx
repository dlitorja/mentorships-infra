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
  searchParams: Promise<{ join?: string; videos?: string }>;
}

/**
 * PR #4c-2: deep-link route for ad-hoc call notifications.
 * PR #3: also handles `?videos={sessionId}` deep-links from the
 * bell's `recording_ready` rows. The two query params are
 * independent — one is for call invites, the other for recordings.
 *
 * URL shape:
 *   - `/workspace/{workspaceId}?join={sessionId}` — auto-join
 *     an ad-hoc call (existing PR #4c-2 behavior).
 *   - `/workspace/{workspaceId}?videos={sessionId}` — open the
 *     videos tab and scroll the matching recording card into
 *     view. Fires `markAcknowledged` once on mount via
 *     `<RecordingAcknowledgedMarker>` so the bell badge clears
 *     without requiring the user to hit "Mark all read".
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
  const { join, videos } = await searchParams;

  if (!convexIdSchema.safeParse(id).success) {
    redirect("/workspace");
  }
  const workspaceId = id as Id<"workspaces">;

  const clerkUserId = await requireAuth();
  const token = await getConvexAuthToken();

  // PR-A (Issue 4): the sidebar in `/workspace/[id]` previously
  // received only `[workspace]` so instructors with multiple
  // workspaces saw a single-entry sidebar when they landed via a
  // deep link (ad-hoc call invite, recording-ready notification,
  // session-reminder, etc.). Fetch the current row and the user's
  // full workspace list in parallel — the picker route at
  // `app/workspace/page.tsx:39-43` already does the same shape.
  const [workspace, allWorkspaces] = await Promise.all([
    fetchQuery(
      api.workspaces.getWorkspaceByIdForUser,
      { id: workspaceId },
      { token: token ?? undefined }
    ),
    fetchQuery(
      api.workspaces.getUserWorkspaces,
      { ownerId: clerkUserId },
      { token: token ?? undefined }
    ),
  ]);

  if (!workspace) {
    redirect("/workspace");
  }

  // Greptile round-1 P1: ensure the current row is in the sidebar
  // list even when `getUserWorkspaces` does not surface it. Admins
  // can access any workspace by id (`getWorkspaceByIdForUser`
  // authorises them), but `getUserWorkspaces` only returns rows
  // owned by the admin or assigned to them as instructor — neither
  // covers admin_student / admin_instructor workspaces where the
  // admin is a participant but not owner. Without this merge the
  // sidebar renders "Select a workspace to get started" even
  // though the current page is authorised. Deduplicate on _id so
  // a user who *does* own/instruct the current workspace doesn't
  // see it twice.
  const workspaces = [
    workspace,
    ...allWorkspaces.filter((w) => w._id !== workspaceId),
  ];

  const userRole: UserRole = (await getServerUserRole(clerkUserId)).role;

  const joinSessionId =
    typeof join === "string" && convexIdSchema.safeParse(join).success
      ? (join as Id<"sessions">)
      : undefined;

  // PR #3: validate `videos` against the same Convex id schema.
  // We deliberately do NOT require it to also resolve to a session
  // row here — `WorkspaceCalls` renders gracefully even when the
  // deep-link target sessionId has no recording yet (the
  // `<DeepLinkScroller />` simply finds no DOM node and no-ops).
  const videoSessionId =
    typeof videos === "string" && convexIdSchema.safeParse(videos).success
      ? (videos as Id<"sessions">)
      : undefined;

  return (
    <ProtectedLayout currentPath="/workspace">
      <WorkspaceClientPage
        clerkUserId={clerkUserId}
        workspaces={workspaces}
        userRole={userRole}
        initialWorkspaceId={workspaceId}
        initialJoinSessionId={joinSessionId}
        initialVideoSessionId={videoSessionId}
      />
      {joinSessionId && (
        <IncomingCallMarker initialJoinSessionId={joinSessionId} />
      )}
      {/*
       * PR #3 R1 fix: removed the standalone
       * `<RecordingAcknowledgedMarker>` previously mounted here.
       * Ack is now owned by
       * `<RecordingDeepLinkHandler>` inside `<WorkspaceCalls>`
       * (calls-tab.tsx) so the ack fires only after the recording
       * card has actually been located across paginated pages AND
       * the notification row's `workspaceId` matches the current
       * workspace — Greptile R1 P1 #2 (deep-link missed later
       * pages) and P1 #3 (cross-workspace ack).
       */}
    </ProtectedLayout>
  );
}
