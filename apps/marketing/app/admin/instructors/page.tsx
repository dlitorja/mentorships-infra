"use client";

import { InstructorsTable } from "@/components/admin/instructors-table";

/**
 * PR admin-mirror #4: the /admin/instructors page is now a thin
 * client-only wrapper around `<InstructorsTable />`. Authorization
 * is enforced server-side by Convex `getInstructorsWithStatsForAdmin`
 * (and the supporting queries/mutations) — the query throws
 * `Unauthorized`/`Forbidden` when the caller is not an admin, and
 * React Query surfaces that as `error`, which the table renders.
 *
 * This replaces the previous SSR pattern that called Drizzle
 * `getAllInstructorsWithStats` (the source of the
 * `operator does not exist: text = uuid` 500). The Clerk
 * `requireAdmin()` gate moved to `app/admin/layout.tsx`, so any
 * unauthenticated request is redirected before reaching this page.
 */
export default function AdminInstructorsPage(): React.ReactElement {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">Instructors</h1>
      <p className="text-muted-foreground mb-8">
        View all instructors, their active students, and session details.
      </p>

      <InstructorsTable />
    </div>
  );
}
