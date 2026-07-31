"use client";

import { useEffect, useRef } from "react";
import { syncInstructorRole } from "@/lib/queries/api-client";

/**
 * Ensures the current Clerk user is recorded as role "instructor" in Convex.
 * Calls POST /api/instructor/sync-role once on mount (idempotent server-side).
 */
export function EnsureInstructorRole() {
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;
    // Best-effort POST; failures are non-fatal and will be retried on next visit.
    syncInstructorRole().catch((error) => {
      console.warn("Failed to sync instructor role:", error);
    });
  }, []);

  // No UI — this is a silent bootstrap step
  return null;
}
