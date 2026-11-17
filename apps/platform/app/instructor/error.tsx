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
 * Recovery uses Next's `retry` prop (stable since 16.3), which re-fetches
 * and re-renders the segment — the only thing that actually re-runs the
 * failed server component and therefore re-attempts the Clerk token mint.
 * `reset` only clears the boundary state without refetching, so it is used
 * purely as a fallback when `retry` is unavailable.
 *
 * Deliberately does not render `error.message`: server errors are
 * redacted in production anyway, and client-thrown values may not be an
 * `Error`. The digest is shown instead so support can correlate with logs.
 */
function digestOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("digest" in error)) {
    return undefined;
  }
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" ? digest : undefined;
}

export default function InstructorError({
  error,
  retry,
  reset,
}: {
  error: unknown;
  retry?: () => void;
  reset?: () => void;
}) {
  const attemptRecovery = retry ?? reset;
  const digest = digestOf(error);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6 text-center">
        <h1 className="text-xl font-semibold">We couldn&apos;t load this page</h1>
        <p className="text-muted-foreground">
          This is usually temporary. Try again — you are still signed in.
        </p>
        <Button onClick={() => attemptRecovery?.()}>Try again</Button>
        <p className="text-xs text-muted-foreground">
          If it keeps happening, contact support
          {digest ? ` and mention reference ${digest}` : ""}.
        </p>
      </div>
    </div>
  );
}
