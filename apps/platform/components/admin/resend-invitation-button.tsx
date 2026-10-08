"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { ApiFetchError, resendAdminOnboardingInvitation } from "@/lib/queries/api-client";

/**
 * PR 12 PR 2 — "Resend invitation" button for the admin onboarding
 * recovery dashboard.
 *
 * Wires the existing API route (`/api/admin/onboardings/[id]/resend-invitation`)
 * to the UI. The route:
 *   - revokes the prior Clerk invitation (best-effort)
 *   - mints a fresh one via `createStudentClerkInvitation`
 *   - patches `perInstructor[i].clerkInvitationId` for non-renewal
 *     pairs via the `resendAdminOnboardingInvitation` Convex mutation
 *   - if the prior status was `failed`, chains `retryAdminOnboarding`
 *     so the Inngest pipeline re-drives
 *
 * The button hides itself when the row's current status doesn't allow
 * a resend (PR 2 enforces this in both the route and the mutation; the
 * UI hides preemptively so admins don't see an action that would
 * 409). Specifically: terminal states (`completed`, `cancelled`) and
 * renewal-only rows (no `clerkInvitationId` on any pair) are hidden.
 *
 * Variants:
 *   - `variant="default"` — detail page (prominent Resend button,
 *     shown next to `RetryOnboardingButton`)
 *
 * On success, refreshes the current route so list/detail Convex
 * queries re-fetch. On error, shows a sonner toast with the API's
 * error message.
 */
export function ResendInvitationButton({
  onboardingId,
  currentStatus,
  hasInvitationId,
  variant = "default",
  size = "sm",
  label = "Resend invitation",
}: {
  onboardingId: string;
  currentStatus: "queued" | "processing" | "completed" | "failed" | "cancelled";
  /**
   * Whether any `perInstructor[i].clerkInvitationId` is set. Passed
   * in by the page so the button can hide preemptively on
   * renewal-only rows where no Clerk invite was ever minted.
   */
  hasInvitationId: boolean;
  variant?: "default" | "ghost" | "outline" | "destructive" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  label?: string;
}): React.JSX.Element | null {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  if (currentStatus === "completed" || currentStatus === "cancelled") {
    return null;
  }
  if (!hasInvitationId) {
    return null;
  }

  async function handleClick(): Promise<void> {
    if (pending) return;
    const confirmed =
      typeof window !== "undefined"
        ? window.confirm(
            `Resend the Clerk invitation for this onboarding? The previous invitation will be revoked and a new signup email will be sent. Existing workspaces will not be affected.`
          )
        : true;
    if (!confirmed) return;
    setPending(true);
    try {
      const body = await resendAdminOnboardingInvitation(onboardingId);
      // The route returns HTTP 200 even when the retry chain fails
      // downstream (e.g. Inngest event send). Surface that as a
      // warning toast so staff know the invitation was sent but the
      // pipeline needs another nudge. Greptile P2 finding.
      if (body.failureReason) {
        toast.warning(
          `Invitation resent, but pipeline did not start: ${body.failureReason}`
        );
      } else {
        toast.success(
          currentStatus === "failed"
            ? `Invitation resent and onboarding re-queued`
            : `Invitation resent (status: ${body.status})`
        );
      }
      router.refresh();
    } catch (err) {
      if (err instanceof ApiFetchError && typeof err.data === "object" && err.data !== null && "error" in err.data && typeof err.data.error === "string") {
        toast.error(err.data.error);
      } else {
        toast.error(err instanceof Error ? err.message : "Resend failed");
      }
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
      aria-label={`Resend invitation for onboarding ${onboardingId}`}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
      ) : (
        <Mail className="h-4 w-4 mr-1" />
      )}
      {label}
    </Button>
  );
}
