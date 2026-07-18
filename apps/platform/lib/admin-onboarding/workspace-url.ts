/**
 * R6 (PR 15): pure helper that returns the URL the student (or admin
 * reviewing the summary) should visit to open the per-instructor
 * workspace for one row of `adminOnboardings.perInstructor`.
 *
 *   - If `p.workspaceId` is set (a new workspace was created in this
 *     onboarding), return `<baseUrl>/dashboard/workspaces/<id>`. This
 *     is the new per-instructor dashboard route added in PR 15 (see
 *     `apps/platform/app/dashboard/workspaces/[id]/page.tsx`).
 *   - Otherwise (a renewal onboarding that reused an existing
 *     workspace; `p.workspaceId` is undefined), fall back to
 *     `<baseUrl>/dashboard` so the link still lands the user on their
 *     dashboard instead of 404ing on an empty workspace id.
 *
 * Lives in `apps/platform/lib/admin-onboarding/` so it can be unit-tested
 * without a Convex runtime or an Inngest step. The Inngest function
 * (`apps/platform/inngest/functions/onboarding.ts`) imports it.
 *
 * `perInstructorEntry` is typed structurally here (only the
 * `workspaceId` field is used) to avoid pulling the full
 * `Doc<"adminOnboardings">` generic into a leaf helper module.
 */

export interface PerInstructorEntryForUrl {
  workspaceId?: string | undefined;
}

export function workspaceUrlFor(
  baseUrl: string,
  p: PerInstructorEntryForUrl,
): string {
  return p.workspaceId
    ? baseUrl + "/dashboard/workspaces/" + p.workspaceId
    : baseUrl + "/dashboard";
}
