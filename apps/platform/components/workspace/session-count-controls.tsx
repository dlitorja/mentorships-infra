"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2, Pencil, RotateCcw } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSessionPack } from "@/lib/queries/convex/use-session-packs";
import { updateSessionPack } from "@/lib/queries/api-client";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";

type SessionCountControlsProps = {
  sessionPackId: Id<"sessionPacks">;
};

type PendingAction = "edit" | "restore";
type SessionCountSnapshot = {
  remainingSessions: number;
  totalSessions: number;
};

/**
 * Returns a readable label for the number of remaining sessions.
 */
function formatRemainingLabel(remaining: number): string {
  return `${remaining} ${remaining === 1 ? "session" : "sessions"} remaining`;
}

/**
 * Renders a pill with the remaining session count plus edit/reset controls for instructors.
 */
export function SessionCountControls({ sessionPackId }: SessionCountControlsProps) {
  const { data: sessionPack, isLoading, refetch } = useSessionPack(sessionPackId);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const pendingRef = useRef(false);
  const latestCountRef = useRef<SessionCountSnapshot>({ remainingSessions: 0, totalSessions: 0 });
  // Snapshot of { totalSessions, remainingSessions } used by the
  // Reset button to undo instructor-local adjustments since the last
  // server-confirmed state.
  //
  // Updated on every subscription push that is NOT the echo of our
  // own PATCH. External activity — another instructor consuming a
  // credit, the expiry job decrementing, a refund — is automatically
  // rolled into the snapshot, so Reset only undoes changes made on
  // THIS page.
  //
  // Recaptured wholesale when the instructor switches to a different
  // session pack.
  //
  // Stored in state (not a ref) so the snapshot write schedules a
  // re-render. The Reset button's aria-label/title and disabled
  // state read this directly, so a ref-only write would leave the
  // UI stale on the first capture (see PR review for context).
  const [pageLoadSnapshot, setPageLoadSnapshot] =
    useState<SessionCountSnapshot | null>(null);
  const capturedForPackIdRef = useRef<string | null>(null);
  const [optimisticCount, setOptimisticCount] = useState<SessionCountSnapshot | null>(null);
  // Tracks the last subscription value we observed so we can tell
  // "new value arrived" (external update or own PATCH echo) apart
  // from "same value re-pushed" (no-op). Updated synchronously by
  // the subscription effect below.
  const lastSubscriptionValueRef = useRef<SessionCountSnapshot | null>(null);

  // Edit dialog state. Inputs are stored as strings so we can
  // enforce strict digit-only sanitization on every keystroke before
  // the value ever reaches state. Parse happens at submit time.
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editRemainingInput, setEditRemainingInput] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);
  // Snapshot of { total, remaining } taken the moment the Edit
  // dialog opens. Used as the optimistic-concurrency `expected`
  // value on submit so a subscription push that arrives while the
  // dialog is open cannot become the new baseline — that would let
  // a stale form overwrite activity from another instructor / tab /
  // system job and silently restore a consumed credit. See the
  // Greptile sequence-diagram finding on PR #663.
  const expectedAtEditOpenRef = useRef<SessionCountSnapshot | null>(null);

  // Reset confirmation dialog state.
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  // Effect 1: capture / clear snapshot when the session pack reference
  // changes. Runs whenever `sessionPack` changes identity, but the
  // `_id` guard inside ensures recapture only happens when the pack id
  // differs from the one already captured. This keeps it from re-running
  // when Convex pushes new counts for the same pack.
  useEffect(() => {
    if (!sessionPack) {
      capturedForPackIdRef.current = null;
      setPageLoadSnapshot(null);
      setOptimisticCount(null);
      lastSubscriptionValueRef.current = null;
      return;
    }
    if (capturedForPackIdRef.current !== sessionPack._id) {
      capturedForPackIdRef.current = sessionPack._id;
      setPageLoadSnapshot({
        totalSessions: sessionPack.totalSessions,
        remainingSessions: sessionPack.remainingSessions,
      });
      setOptimisticCount(null);
      lastSubscriptionValueRef.current = {
        remainingSessions: sessionPack.remainingSessions,
        totalSessions: sessionPack.totalSessions,
      };
    }
  }, [sessionPack]);

  // Effect 2: classify each subscription push for the current pack.
  // Runs whenever `sessionPack` or `optimisticCount` changes. The early
  // same-value checks inside prevent no-op re-renders and self-induced
  // state writes from doing extra work. External subscription pushes and
  // the echo of our own PATCH are handled by the same path.
  useEffect(() => {
    if (!sessionPack) return;
    const incoming: SessionCountSnapshot = {
      remainingSessions: sessionPack.remainingSessions,
      totalSessions: sessionPack.totalSessions,
    };
    const prev = lastSubscriptionValueRef.current;
    lastSubscriptionValueRef.current = incoming;
    if (!prev) return;
    if (
      prev.remainingSessions === incoming.remainingSessions &&
      prev.totalSessions === incoming.totalSessions
    ) {
      // Same value re-pushed — nothing to do.
      return;
    }
    // Echo of our own PATCH: clear the optimistic override and leave
    // the snapshot pinned to pre-PATCH state so the user can still
    // Reset to undo their local action.
    if (
      optimisticCount !== null &&
      optimisticCount.remainingSessions === incoming.remainingSessions &&
      optimisticCount.totalSessions === incoming.totalSessions
    ) {
      setOptimisticCount(null);
      return;
    }
    // External update: roll the snapshot forward so Reset never
    // overwrites activity from another instructor / tab / system job.
    setPageLoadSnapshot(incoming);
  }, [sessionPack, optimisticCount]);

  const remainingSessions = optimisticCount?.remainingSessions ?? sessionPack?.remainingSessions ?? 0;
  const totalSessions = optimisticCount?.totalSessions ?? sessionPack?.totalSessions ?? 0;

  useLayoutEffect(() => {
    latestCountRef.current = { remainingSessions, totalSessions };
  }, [remainingSessions, totalSessions]);

  const syncFromServer = useCallback(async () => {
    const result = await refetch();
    if (result.data) {
      const serverCount = {
        remainingSessions: result.data.remainingSessions,
        totalSessions: result.data.totalSessions,
      };
      // Treat a manual server refetch as a new baseline: update the
      // snapshot so Reset uses the latest accepted server values, and
      // clear any optimistic override so it is not mistaken for a local
      // PATCH echo in the subscription effect.
      setPageLoadSnapshot(serverCount);
      setOptimisticCount(null);
      latestCountRef.current = serverCount;
      lastSubscriptionValueRef.current = serverCount;
    } else {
      setOptimisticCount(null);
    }
  }, [refetch]);

  /**
   * Strip every non-digit character from a freeform input string.
   * Used by the Edit dialog so the typed value can only ever be a
   * non-negative integer — blocks `-`, `.`, `e`, `+`, letters,
   * whitespace, and any other non-digit before they ever reach
   * React state.
   */
  const sanitizeDigits = useCallback((value: string): string => {
    return value.replace(/[^0-9]/g, "");
  }, []);

  /**
   * Open the Edit dialog and seed its inputs with the current
   * values. We read from `latestCountRef` (not the live render
   * values) so the dialog stays consistent if a subscription push
   * fires between the click and the dialog mounting. Also snapshots
   * the current count into `expectedAtEditOpenRef` so the
   * optimistic-concurrency `expected` value on submit stays pinned
   * to what the user saw, not to whatever value the subscription
   * pushes while the dialog is open.
   */
  const openEditDialog = useCallback(() => {
    const current = latestCountRef.current;
    expectedAtEditOpenRef.current = { ...current };
    setEditRemainingInput(String(current.remainingSessions));
    setEditError(null);
    setEditDialogOpen(true);
  }, []);

  /**
   * Submit the Edit dialog. Validates strictly on submit
   * (parseInt with radix 10), rejects remaining > total, and
   * surfaces a friendly inline error inside the dialog instead of
   * a toast. The PATCH goes through the new `setBoth` API action
   * which atomically updates both fields with optimistic-concurrency
   * check.
   */
  const submitEdit = useCallback(async () => {
    if (pendingRef.current) return;
    if (isEditSubmitting) return;

    // Instructors only manage remaining sessions; total is a
    // backend/admin-only field used for refunds and reporting.
    const total = latestCountRef.current.totalSessions;
    const remaining = parseInt(editRemainingInput, 10);

    if (editRemainingInput.trim() === "" || Number.isNaN(remaining)) {
      setEditError("Remaining must be a whole number.");
      return;
    }
    if (remaining < 0) {
      setEditError("Remaining cannot be negative.");
      return;
    }
    if (remaining > total) {
      setEditError("Remaining cannot exceed the original pack size.");
      return;
    }

    setEditError(null);
    setIsEditSubmitting(true);

    // Use the snapshot taken when the dialog opened, not the live
    // ref. Otherwise a subscription push that arrives while the
    // dialog is open can become the new `expected` baseline and let
    // a stale form overwrite activity from another instructor / tab
    // / system job. If the dialog was opened before this snapshot
    // existed (shouldn't happen — `openEditDialog` always writes
    // the snapshot — but defends against future refactors), fall
    // back to the live ref so we don't accidentally pass stale data.
    const expected = expectedAtEditOpenRef.current ?? latestCountRef.current;
    const target: SessionCountSnapshot = {
      totalSessions: total,
      remainingSessions: remaining,
    };

    pendingRef.current = true;
    setPendingAction("edit");
    setOptimisticCount(target);
    latestCountRef.current = target;

    try {
      const { ok, status, json } = await updateSessionPack(sessionPackId, {
        action: "setBoth",
        totalSessions: target.totalSessions,
        remainingSessions: target.remainingSessions,
        expectedTotalSessions: expected.totalSessions,
        expectedRemainingSessions: expected.remainingSessions,
      });

      if (status === 409) {
        toast.error("This session pack changed — refresh to see the latest and try again.", {
          action: {
            label: "Reload",
            onClick: () => {
              void refetch();
            },
          },
        });
        await syncFromServer();
        setEditDialogOpen(false);
        return;
      }

      if (!ok || !json.sessionPack) {
        throw new Error(json.error || "Failed to update session count");
      }

      const updatedCount = {
        remainingSessions: json.sessionPack.remainingSessions,
        totalSessions: json.sessionPack.totalSessions,
      };
      setOptimisticCount(updatedCount);
      latestCountRef.current = updatedCount;
      void refetch();
      toast.success(`Updated to ${formatRemainingLabel(updatedCount.remainingSessions)}.`);
      setEditDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update session count");
      await syncFromServer();
    } finally {
      pendingRef.current = false;
      setPendingAction(null);
      setIsEditSubmitting(false);
    }
  }, [editRemainingInput, isEditSubmitting, refetch, sessionPackId, syncFromServer]);

  /**
   * Reset the pack to the { totalSessions, remainingSessions } it had
   * when this component first rendered it. Reuses the same `restore`
   * API action the existing undo flow uses, with the page-load
   * snapshot as the target and the live count as the optimistic
   * concurrency check. Returns early (no-op) if there's no snapshot
   * yet (pack still loading) or if the current state already matches
   * the snapshot.
   *
   * Confirmation flow: opens a Radix Dialog instead of the
   * (blockable, iframe-unfriendly) `window.confirm`. The Dialog
   * itself owns the "open" state, so callers toggle it via
   * `setResetConfirmOpen`.
   */
  const resetSessions = useCallback(async () => {
    if (pendingRef.current) return;
    const snapshot = pageLoadSnapshot;
    if (!snapshot) return;
    const expected = latestCountRef.current;
    if (
      expected.totalSessions === snapshot.totalSessions &&
      expected.remainingSessions === snapshot.remainingSessions
    ) {
      return;
    }

    pendingRef.current = true;
    setPendingAction("restore");
    setOptimisticCount({
      totalSessions: snapshot.totalSessions,
      remainingSessions: snapshot.remainingSessions,
    });
    latestCountRef.current = {
      totalSessions: snapshot.totalSessions,
      remainingSessions: snapshot.remainingSessions,
    };

    try {
      const { ok, status, json } = await updateSessionPack(sessionPackId, {
        action: "restore",
        totalSessions: snapshot.totalSessions,
        remainingSessions: snapshot.remainingSessions,
        expectedTotalSessions: expected.totalSessions,
        expectedRemainingSessions: expected.remainingSessions,
      });

      if (status === 409) {
        toast.error("This session pack changed — refresh to see the latest and try again.", {
          action: {
            label: "Reload",
            onClick: () => {
              void refetch();
            },
          },
        });
        await syncFromServer();
        return;
      }

      if (!ok || !json.sessionPack) {
        throw new Error(json.error || "Failed to reset sessions");
      }

      const restoredCount = {
        remainingSessions: json.sessionPack.remainingSessions,
        totalSessions: json.sessionPack.totalSessions,
      };
      setOptimisticCount(restoredCount);
      latestCountRef.current = restoredCount;
      void refetch();
      toast.success(`Reset to ${formatRemainingLabel(restoredCount.remainingSessions)}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reset sessions");
      await syncFromServer();
    } finally {
      pendingRef.current = false;
      setPendingAction(null);
    }
  }, [pageLoadSnapshot, refetch, sessionPackId, syncFromServer]);

  if (isLoading) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading sessions
      </div>
    );
  }

  if (!sessionPack) return null;

  const isPending = pendingAction !== null;
  const snapshot = pageLoadSnapshot;
  // Reset is a no-op when:
  //   - any action is already in flight,
  //   - the snapshot hasn't been captured yet (pack still loading),
  //   - the current count already matches the page-load snapshot
  //     (e.g. the user opened the page after a previous reset).
  const resetDisabled =
    isPending ||
    snapshot === null ||
    (totalSessions === snapshot.totalSessions &&
      remainingSessions === snapshot.remainingSessions);

  return (
    <>
      <div
        className={cn(
          "inline-flex items-center overflow-hidden rounded-full border bg-background text-sm shadow-sm",
          remainingSessions === 0 && "border-destructive/50",
          remainingSessions === 1 && "border-yellow-500/50"
        )}
        aria-label={formatRemainingLabel(remainingSessions)}
      >
        <div className="px-3 py-1.5 font-medium">
          {formatRemainingLabel(remainingSessions)}
        </div>
        <div className="w-px h-6 bg-border" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-none"
          disabled={isPending}
          aria-label="Edit session count"
          title="Edit session count"
          onClick={openEditDialog}
        >
          {pendingAction === "edit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-none"
          disabled={resetDisabled}
          aria-label={
            snapshot
              ? `Reset session count to ${formatRemainingLabel(snapshot.remainingSessions)}`
              : "Reset session count (loading…)"
          }
          title={
            snapshot
              ? `Reset to ${formatRemainingLabel(snapshot.remainingSessions)} (restores the count from before your changes on this page)`
              : "Reset session count"
          }
          onClick={() => setResetConfirmOpen(true)}
        >
          {pendingAction === "restore" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
        </Button>
      </div>

      <Dialog
        open={editDialogOpen}
        onOpenChange={(open) => {
          if (isEditSubmitting) return;
          setEditDialogOpen(open);
          if (!open) {
            setEditError(null);
            // Clear the open-time snapshot so the next open re-snapshots
            // from the current `latestCountRef`. Without this, a stale
            // snapshot from a previous open could leak into the next
            // submit's `expected` baseline.
            expectedAtEditOpenRef.current = null;
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit remaining sessions</DialogTitle>
            <DialogDescription>
              Set how many sessions this student has remaining. The value must be a whole number and cannot exceed the original pack size.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitEdit();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="session-pack-remaining">Remaining sessions</Label>
              <Input
                id="session-pack-remaining"
                name="remainingSessions"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                value={editRemainingInput}
                onChange={(e) => setEditRemainingInput(sanitizeDigits(e.target.value))}
                disabled={isEditSubmitting}
                aria-invalid={
                  editError !== null &&
                  (Number.isNaN(parseInt(editRemainingInput, 10)) ||
                    parseInt(editRemainingInput, 10) > totalSessions)
                }
              />
            </div>
            {editError && (
              <p className="text-sm text-destructive" role="alert">
                {editError}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditDialogOpen(false);
                  setEditError(null);
                }}
                disabled={isEditSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isEditSubmitting}>
                {isEditSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={resetConfirmOpen}
        onOpenChange={(open) => {
          if (isPending) return;
          setResetConfirmOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset session count?</DialogTitle>
            <DialogDescription>
              {snapshot
                ? `Reset session count to ${formatRemainingLabel(snapshot.remainingSessions)}? This restores the count from before your changes on this page.`
                : "Loading…"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setResetConfirmOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setResetConfirmOpen(false);
                void resetSessions();
              }}
              disabled={isPending || !snapshot}
            >
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
