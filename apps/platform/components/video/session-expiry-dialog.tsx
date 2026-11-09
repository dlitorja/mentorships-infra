"use client";

import { useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type SessionExpiryDialogProps = {
  open: boolean;
  /** Clerk session expiry; used only for the copy. */
  expiresAt: Date | null;
  /**
   * Where to send the user after re-auth. Should be a `/workspace/...`
   * path so the existing auth-redirect whitelist preserves it. Null
   * falls back to `/workspace`.
   */
  returnPath: string | null;
  /** Called when the user dismisses the dialog without joining. */
  onOpenChange: (open: boolean) => void;
  /** Called when the user accepts the risk and joins anyway. */
  onJoinAnyway: () => void;
};

function formatExpiry(expiresAt: Date | null): string {
  if (!expiresAt) return "soon";
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(expiresAt);
  } catch {
    return expiresAt.toLocaleString();
  }
}

/**
 * Pre-call guard for Clerk's fixed maximum session lifetime.
 *
 * A Clerk session's `expireAt` is fixed at sign-in and is not extended by
 * activity. When it lands inside a call, Clerk stops issuing session
 * tokens mid-call, Convex auth flips to unauthenticated, and the next
 * navigation redirects the user to /sign-in — which also tears down the
 * Daily call. This dialog asks the user to re-authenticate first, minting
 * a new session with a fresh lifetime.
 *
 * "Join anyway" is intentionally available: a user joining a very short
 * call may prefer not to sign out now, and the guard is advisory rather
 * than a hard auth gate.
 */
export function SessionExpiryDialog({
  open,
  expiresAt,
  returnPath,
  onOpenChange,
  onJoinAnyway,
}: SessionExpiryDialogProps) {
  const { signOut } = useClerk();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignInAgain = async (): Promise<void> => {
    setIsSigningOut(true);
    try {
      const target =
        returnPath ??
        (typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : "/workspace");
      // Route through the bounce-redirect handler so the destination
      // survives Clerk's forced `/auth-redirect` return (see
      // app/api/auth/bounce-redirect/route.ts). `returnPath` is always a
      // `/workspace/...` path, which the whitelist accepts. Signing out
      // first is required: a fresh sign-in is what mints a new session
      // with a new maximum lifetime.
      await signOut({
        redirectUrl: `/api/auth/bounce-redirect?redirect_url=${encodeURIComponent(target)}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Could not sign you out", { description: message });
      setIsSigningOut(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isSigningOut) return;
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" aria-hidden="true" />
            Sign in again before joining
          </DialogTitle>
          <DialogDescription>
            Your sign-in session expires{" "}
            <strong>{formatExpiry(expiresAt)}</strong>, which is before this
            call&apos;s maximum length. If you join now, you&apos;ll be signed
            out in the middle of the call. Sign in again first — you&apos;ll
            come straight back to this workspace.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isSigningOut}
            onClick={onJoinAnyway}
          >
            Join anyway
          </Button>
          <Button
            type="button"
            disabled={isSigningOut}
            onClick={() => void handleSignInAgain()}
          >
            {isSigningOut ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            Sign in again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
