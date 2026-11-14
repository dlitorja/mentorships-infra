"use client";

import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary for the instructor area.
 *
 * Without this file, any error thrown while rendering an `/instructor/*`
 * page propagates to the root and Next shows its generic
 * "Application error: a server-side exception has occurred" page — a dead
 * end with no navigation and no retry. That is what an instructor saw when
 * a transient Clerk failure hit `/instructor/dashboard` seconds after she
 * signed in (Nov 2026), and it reads as "login is broken".
 *
 * `reset()` re-renders the segment, which re-runs the server component and
 * re-attempts the Clerk token mint — the correct remedy for the transient
 * backend failures this boundary exists for. Deliberately does not show
 * `error.message`: server messages can carry internal detail, and the
 * digest is enough for support to correlate with logs.
 */
export default function InstructorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6 text-center">
        <h1 className="text-xl font-semibold">We couldn&apos;t load this page</h1>
        <p className="text-muted-foreground">
          This is usually temporary. Try again — you are still signed in.
        </p>
        <Button onClick={reset}>Try again</Button>
        <p className="text-xs text-muted-foreground">
          If it keeps happening, contact support
          {error.digest ? ` and mention reference ${error.digest}` : ""}.
        </p>
      </div>
    </div>
  );
}
