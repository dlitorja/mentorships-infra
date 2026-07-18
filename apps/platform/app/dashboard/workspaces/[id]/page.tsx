import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getConvexAuthToken, getServerUserRole } from "@/lib/auth-helpers";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import WorkspaceClientPage from "@/components/workspace/workspace-client-page";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { convexIdSchema } from "@/lib/validators";
import { Loader2 } from "lucide-react";
import type { UserRole } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

interface DashboardWorkspaceIdPageProps {
  params: Promise<{ id: string }>;
}

/**
 * R6 (PR 15): per-instructor dashboard route for admin-onboarded
 * workspaces.
 *
 * URL shape: `/dashboard/workspaces/{workspaceId}` where `workspaceId`
 * is a `Convex Id<"workspaces">` taken from the admin-onboarding row's
 * `perInstructor[].workspaceId` (PR 5 era). The link is reached from
 * the admin-onboarding student email's per-instructor `workspaceUrl`
 * and from the admin summary email's per-instructor row.
 *
 * Behavior:
 *   - Mirrors the existing `/workspace/[id]` deep-link route but
 *     parented under `/dashboard` (so the URL reflects the
 *     source-of-truth navigation context: admin-onboarding emails
 *     land here from the student/admin dashboard, not from the
 *     standalone Workspace picker).
 *   - Uses `currentPath="/workspace"` to highlight the active nav
 *     item, mirroring `/workspace/[id]` and matching the fact that
 *     the page IS a workspace view. The `/workspace` nav item exists
 *     in BOTH the student and the instructor/admin navigation, so
 *     every reachable role sees an active item. (Greptile P2 finding
 *     on the initial PR: admin/instructor nav has no `/dashboard`
 *     item, so `currentPath="/dashboard"` would have left their nav
 *     un-highlighted.)
 *   - Reuses `WorkspaceClientPage` so the rendering is identical to
 *     `/workspace/[id]` -- no duplicated workspace UI.
 *   - Does NOT accept `?join={sessionId}` because the dashboard route
 *     is reached from a static email link, not from a live
 *     notification deep-link. The `/workspace/[id]?join=` flow remains
 *     the deep-link entry point.
 *
 * Auth gate (server-side): `getWorkspaceByIdForUser` returns `null`
 * if the caller is not a participant on the workspace OR the
 * workspace is soft-deleted/ended. We redirect to `/dashboard` in
 * that case rather than 404 -- same UX as `/workspace/[id]` which
 * redirects to `/workspace`.
 *
 * Build-time guard matches the existing `/workspace/[id]/page.tsx` so
 * the static export does not crash when `NEXT_PUBLIC_CLERK_*` is a
 * placeholder during prebuild.
 */
export default async function DashboardWorkspaceIdPage({
  params,
}: DashboardWorkspaceIdPageProps) {
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

  if (!convexIdSchema.safeParse(id).success) {
    redirect("/dashboard");
  }
  const workspaceId = id as Id<"workspaces">;

  const clerkUserId = await requireAuth();
  const token = await getConvexAuthToken();

  const workspace = await fetchQuery(
    api.workspaces.getWorkspaceByIdForUser,
    { id: workspaceId },
    { token: token ?? undefined }
  );

  if (!workspace) {
    redirect("/dashboard");
  }

  const userRole: UserRole = await getServerUserRole(clerkUserId);

  return (
    <ProtectedLayout currentPath="/workspace">
      <WorkspaceClientPage
        clerkUserId={clerkUserId}
        workspaces={[workspace]}
        userRole={userRole}
        initialWorkspaceId={workspaceId}
      />
    </ProtectedLayout>
  );
}
