"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Minus, Plus } from "lucide-react";
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

export function SessionCountControls({ sessionPackId }: SessionCountControlsProps) {
  const { data: sessionPack, isLoading, refetch } = useSessionPack(sessionPackId);
  const [pendingAction, setPendingAction] = useState<AdjustmentAction | null>(null);
  const pendingRef = useRef(false);
  const latestCountRef = useRef({ remainingSessions: 0, totalSessions: 0 });
  const [optimisticCount, setOptimisticCount] = useState<{
    remainingSessions: number;
    totalSessions: number;
  } | null>(null);

  useEffect(() => {
    setOptimisticCount(null);
  }, [sessionPack?._id, sessionPack?.remainingSessions, sessionPack?.totalSessions]);

  const adjustSessions = useCallback(async (action: AdjustmentAction, showUndo = true) => {
    if (pendingRef.current) return;

    const currentCount = latestCountRef.current;
    if (action === "decrement" && currentCount.remainingSessions <= 0) return;

    const previousCount = currentCount;
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
      const json = (await response.json()) as Partial<SessionPackPatchResponse> & { error?: string };

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
      const oppositeAction: AdjustmentAction = action === "increment" ? "decrement" : "increment";
      toast.success(`${message}. ${json.sessionPack.remainingSessions} left.`, {
        action: showUndo
          ? {
              label: "Undo",
              onClick: () => void adjustSessions(oppositeAction, false),
            }
          : undefined,
      });
    } catch (error) {
      setOptimisticCount(previousCount);
      latestCountRef.current = previousCount;
      toast.error(error instanceof Error ? error.message : "Failed to update sessions");
    } finally {
      pendingRef.current = false;
      setPendingAction(null);
    }
  }, [refetch, sessionPackId]);

  if (isLoading) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading sessions
      </div>
    );
  }

  if (!sessionPack) return null;

  const remainingSessions = optimisticCount?.remainingSessions ?? sessionPack.remainingSessions;
  const totalSessions = optimisticCount?.totalSessions ?? sessionPack.totalSessions;
  const isPending = pendingAction !== null;
  latestCountRef.current = { remainingSessions, totalSessions };

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
        aria-label="Remove one remaining session"
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
        aria-label="Add one remaining session"
        onClick={() => void adjustSessions("increment")}
      >
        {pendingAction === "increment" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
      </Button>
    </div>
  );
}
