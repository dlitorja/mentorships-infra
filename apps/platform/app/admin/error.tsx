"use client";

import { Button } from "@/components/ui/button";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
      <div className="text-muted-foreground">
        {error?.message || "Failed to load admin data. Please try again."}
      </div>
      <Button variant="outline" onClick={reset}>
        Refresh Page
      </Button>
    </div>
  );
}
