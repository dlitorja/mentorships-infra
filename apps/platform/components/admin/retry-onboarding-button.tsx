"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

/**
 * Shared "Retry" button for the admin onboarding recovery dashboard.
 *
 * PR 6 — wires the existing API route (`/api/admin/onboardings/[id]/retry`)
 * to the UI. The API route already:
 *   - calls the `retryAdminOnboarding` Convex mutation (which enforces
 *     state machine: only `failed` or `queued` can retry to `processing`)
 *   - bumps `attemptCount`
 *   - re-emits the `admin/onboarding.completed` Inngest event with the
 *     bumped attemptCount (the existing flow re-runs with idempotency
 *     guards — only undelivered emails get sent again)
 *
 * The button hides itself when the row's current status doesn't allow
 * a retry (PR 4 enforces this in the mutation; the UI hides preemptively
 * so admins don't see an action that would just 409).
 *
 * Variants:
 *   - `variant="default"` — detail page (prominent Retry button)
 *   - `variant="ghost"`   — list page (compact icon button per row)
 *
 * On success, refreshes the current route so list/detail Convex queries
 * re-fetch. On error, shows a sonner toast with the API's error message.
 */
export function RetryOnboardingButton({
  onboardingId,
  currentStatus,
  variant = "default",
  size = "sm",
  label = "Retry",
}: {
  onboardingId: string;
  currentStatus: "queued" | "processing" | "completed" | "failed" | "cancelled";
  variant?: "default" | "ghost" | "outline" | "destructive" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  label?: string;
}): React.JSX.Element | null {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  // Hide preemptively when the state machine would reject the retry.
  if (currentStatus !== "failed" && currentStatus !== "queued") {
    return null;
  }

  async function handleClick(): Promise<void> {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch(`/api/admin/onboardings/${onboardingId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = (await res.json().catch(() => ({}))) as {
        onboardingId?: string;
        status?: string;
        failureReason?: string;
        attemptCount?: number;
        error?: string;
      };
      if (!res.ok) {
        toast.error(body.error ?? `Retry failed (${res.status})`);
        return;
      }
      toast.success(
        body.attemptCount != null
          ? `Retry queued (attempt ${body.attemptCount})`
          : "Retry queued"
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={pending}
      onClick={handleClick}
      aria-label={`Retry onboarding ${onboardingId}`}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
      ) : (
        <RotateCcw className="h-4 w-4 mr-1" />
      )}
      {label}
    </Button>
  );
}
