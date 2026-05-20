"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Ensures the current Clerk user is recorded as role "instructor" in Convex.
 * Calls POST /api/instructor/sync-role once on mount (idempotent server-side).
 */
export function EnsureInstructorRole() {
  const called = useRef(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;
    fetch("/api/instructor/sync-role", { method: "POST" })
      .catch(() => {})
      .finally(() => setDone(true));
  }, []);

  // No UI — this is a silent bootstrap step
  return null;
}
