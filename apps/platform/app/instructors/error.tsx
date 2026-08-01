"use client";

import { Button } from "@/components/ui/button";

export default function InstructorsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-7xl text-center">
          <h1 className="section-title">Our Instructors</h1>
          <p className="mt-4 text-muted-foreground">
            We couldn&apos;t load instructors right now. Please try again.
          </p>
          {error?.message && (
            <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
          )}
          <Button onClick={reset} className="mt-6">
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
