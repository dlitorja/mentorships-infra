"use client";

import { InventoryTable } from "@/components/admin/inventory-table";

/**
 * PR 6: marketing /admin/inventory rewritten to read + write Convex.
 *
 * The admin layout (`app/admin/layout.tsx`) already gates access via
 * `isAdminUser()`, so this page does NOT call `requireAdmin()` itself.
 * The legacy Supabase reads (`getAllInstructorsWithInventory` +
 * `getWaitlistCounts`) are gone — `<InventoryTable />` consumes
 * Convex directly via the `useInventoryInstructors` +
 * `useWaitlistForInstructor` hooks. The static `lib/instructors.ts`
 * config is consumed inside `<InventoryTable />` to render the
 * `has_pricing_*` flags and the instructor's public profile link.
 *
 * The previous server-side `ErrorBoundary` wrapper is also dropped —
 * the table component handles its own loading + error states
 * (matching `apps/web/app/admin/inventory/page.tsx`).
 */
export default function InventoryPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <InventoryTable />
    </div>
  );
}
