"use client";

import { useEffect, useRef } from "react";

/**
 * Ensures the current Clerk user is recorded as role "instructor" in Convex.
 * Calls POST /api/instructor/sync-role once on mount (idempotent server-side).
 */
export function EnsureInstructorRole() {
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;
    // Silent best-effort POST; failures are non-fatal and will be retried on next visit
    fetch("/api/instructor/sync-role", { method: "POST" }).catch(() => {});
  }, []);

  // No UI — this is a silent bootstrap step
  return null;
}
