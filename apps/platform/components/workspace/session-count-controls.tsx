"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2, Minus, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useSessionPack } from "@/lib/queries/convex/use-session-packs";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";

type SessionCountControlsProps = {
  sessionPackId: Id<"sessionPacks">;
};

type SessionPackPatchResponse = {
  success: boolean;
  sessionPack: {
    id: string;
    totalSessions: number;
    remainingSessions: number;
    status: string;
  };
};

type AdjustmentAction = "increment" | "decrement";
type PendingAction = AdjustmentAction | "restore";
type SessionCountSnapshot = {
  remainingSessions: number;
  totalSessions: number;
};

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

  // Effect 1: capture / clear snapshot when the session pack id
  // changes. Triggered only by `_id`, so it doesn't re-run when
  // Convex pushes new counts for the same pack.
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
  }, [sessionPack?._id]);

  // Effect 2: classify each subscription push for the current pack.
  // Runs only when the count values change, so a no-op re-render or
  // the snapshot/echo-clear state writes don't trigger a second pass.
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
  }, [sessionPack?.remainingSessions, sessionPack?.totalSessions]);

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
      setOptimisticCount(serverCount);
      latestCountRef.current = serverCount;
    } else {
      setOptimisticCount(null);
    }
  }, [refetch]);

  const restoreSessions = useCallback(async (target: SessionCountSnapshot, expected: SessionCountSnapshot) => {
    if (pendingRef.current) return;

    pendingRef.current = true;
    setPendingAction("restore");
    setOptimisticCount(target);
    latestCountRef.current = target;

    try {
      const response = await fetch(`/api/instructor/session-packs/${sessionPackId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "restore",
          remainingSessions: target.remainingSessions,
          totalSessions: target.totalSessions,
          expectedRemainingSessions: expected.remainingSessions,
          expectedTotalSessions: expected.totalSessions,
        }),
      });
      let json: Partial<SessionPackPatchResponse> & { error?: string } = {};
      try {
        json = (await response.json()) as typeof json;
      } catch {
        // Non-JSON body, e.g. an HTML proxy error.
      }

      if (!response.ok || !json.sessionPack) {
        throw new Error(json.error || "Failed to restore sessions");
      }

      const restoredCount = {
        remainingSessions: json.sessionPack.remainingSessions,
        totalSessions: json.sessionPack.totalSessions,
      };
      setOptimisticCount(restoredCount);
      latestCountRef.current = restoredCount;
      void refetch();
      toast.success("Session change undone.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to restore sessions");
      await syncFromServer();
    } finally {
      pendingRef.current = false;
      setPendingAction(null);
    }
  }, [refetch, sessionPackId, syncFromServer]);

  /**
   * Reset the pack to the { totalSessions, remainingSessions } it had
   * when this component first rendered it. Reuses the same `restore`
   * API action the existing undo flow uses, with the page-load
   * snapshot as the target and the live count as the optimistic
   * concurrency check. Returns early (no-op) if there's no snapshot
   * yet (pack still loading) or if the current state already matches
   * the snapshot.
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

    const confirmed =
      typeof window !== "undefined"
        ? window.confirm(
            `Reset session count to ${snapshot.remainingSessions} / ${snapshot.totalSessions}? This undoes any manual adjustments since you opened this page.`,
          )
        : true;
    if (!confirmed) return;

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
      const response = await fetch(`/api/instructor/session-packs/${sessionPackId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "restore",
          totalSessions: snapshot.totalSessions,
          remainingSessions: snapshot.remainingSessions,
          expectedTotalSessions: expected.totalSessions,
          expectedRemainingSessions: expected.remainingSessions,
        }),
      });
      let json: Partial<SessionPackPatchResponse> & { error?: string } = {};
      try {
        json = (await response.json()) as typeof json;
      } catch {
        // Non-JSON body, e.g. an HTML proxy error.
      }

      if (!response.ok || !json.sessionPack) {
        throw new Error(json.error || "Failed to reset sessions");
      }

      const restoredCount = {
        remainingSessions: json.sessionPack.remainingSessions,
        totalSessions: json.sessionPack.totalSessions,
      };
      setOptimisticCount(restoredCount);
      latestCountRef.current = restoredCount;
      void refetch();
      toast.success(`Reset to ${restoredCount.remainingSessions} / ${restoredCount.totalSessions} sessions left.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reset sessions");
      await syncFromServer();
    } finally {
      pendingRef.current = false;
      setPendingAction(null);
    }
  }, [pageLoadSnapshot, refetch, sessionPackId, syncFromServer]);

  const adjustSessions = useCallback(async (action: AdjustmentAction, showUndo = true) => {
    if (pendingRef.current) return;

    const currentCount = latestCountRef.current;
    if (action === "decrement" && currentCount.remainingSessions <= 0) return;

    const previousCount = { ...currentCount };
    const nextCount = {
      remainingSessions: action === "increment" ? currentCount.remainingSessions + 1 : currentCount.remainingSessions - 1,
      totalSessions: action === "increment" ? currentCount.totalSessions + 1 : currentCount.totalSessions,
    };

    pendingRef.current = true;
    setPendingAction(action);
    setOptimisticCount(nextCount);
    latestCountRef.current = nextCount;

    try {
      const response = await fetch(`/api/instructor/session-packs/${sessionPackId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, amount: 1 }),
      });
      let json: Partial<SessionPackPatchResponse> & { error?: string } = {};
      try {
        json = (await response.json()) as typeof json;
      } catch {
        // Non-JSON body, e.g. an HTML proxy error.
      }

      if (!response.ok || !json.sessionPack) {
        throw new Error(json.error || "Failed to update sessions");
      }

      const updatedCount = {
        remainingSessions: json.sessionPack.remainingSessions,
        totalSessions: json.sessionPack.totalSessions,
      };
      setOptimisticCount(updatedCount);
      latestCountRef.current = updatedCount;
      void refetch();

      const message = action === "increment" ? "Added 1 session" : "Removed 1 session";
      toast.success(`${message}. ${json.sessionPack.remainingSessions} left.`, {
        action: showUndo
          ? {
              label: "Undo",
              onClick: () => void restoreSessions(previousCount, updatedCount),
            }
          : undefined,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update sessions");
      await syncFromServer();
    } finally {
      pendingRef.current = false;
      setPendingAction(null);
    }
  }, [refetch, restoreSessions, sessionPackId, syncFromServer]);

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
    <div
      className={cn(
        "inline-flex items-center overflow-hidden rounded-full border bg-background text-sm shadow-sm",
        remainingSessions === 0 && "border-destructive/50",
        remainingSessions === 1 && "border-yellow-500/50"
      )}
      aria-label={`${remainingSessions} sessions remaining`}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-none"
        disabled={isPending || remainingSessions <= 0}
        aria-label="Mark one session as completed (decrement remaining)"
        title="Mark one session as completed (decrements remaining)"
        onClick={() => void adjustSessions("decrement")}
      >
        {pendingAction === "decrement" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Minus className="h-4 w-4" />}
      </Button>
      <div className="border-x px-3 py-1.5 font-medium">
        {remainingSessions} / {totalSessions} sessions left
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-none"
        disabled={isPending}
        aria-label="Add a session credit to this student's pack"
        title="Add a session credit to this student's pack (increases total and remaining)"
        onClick={() => void adjustSessions("increment")}
      >
        {pendingAction === "increment" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
      </Button>
      <div className="w-px h-6 bg-border" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-none"
        disabled={resetDisabled}
        aria-label={
          snapshot
            ? `Reset session count to ${snapshot.remainingSessions} / ${snapshot.totalSessions}`
            : "Reset session count (loading…)"
        }
        title={
          snapshot
            ? `Reset to ${snapshot.remainingSessions} / ${snapshot.totalSessions} (undoes manual adjustments since page open)`
            : "Reset session count"
        }
        onClick={() => void resetSessions()}
      >
        {pendingAction === "restore" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
      </Button>
    </div>
  );
}
