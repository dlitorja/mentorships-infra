"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Save, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSessionPack } from "@/lib/queries/convex/use-session-packs";
import { cn } from "@/lib/utils";
import { pluralizeRemaining } from "@/lib/utils/pluralize";
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

const pluralize = pluralizeRemaining;

export function SessionCountControls({ sessionPackId }: SessionCountControlsProps) {
  const { data: sessionPack, isLoading } = useSessionPack(sessionPackId);
  const [isEditing, setIsEditing] = useState(false);
  const [draftRemaining, setDraftRemaining] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  // Optimistic override for the visible remaining count. Set
  // immediately after a successful PATCH so the pill reflects the
  // new value without waiting for the Convex subscription round-trip,
  // and cleared once the subscription pushes the matching value back
  // (so the UI doesn't fight the source of truth).
  const [optimisticRemaining, setOptimisticRemaining] = useState<
    number | null
  >(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Seed the draft from the displayed remaining (which factors in
  // the optimistic override) when entering edit mode, and re-seed
  // if the displayed value changes mid-edit — e.g. Convex confirms
  // an optimistic write or another tab updates the row. Tracks only
  // the numeric remaining value + optimistic override + isEditing
  // so an unrelated Convex field change (status, expiresAt) doesn't
  // silently discard the user's in-progress draft.
  const remainingRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isEditing) return;
    if (!sessionPack) return;
    const displayed = optimisticRemaining ?? sessionPack.remainingSessions;
    if (remainingRef.current === displayed) return;
    remainingRef.current = displayed;
    setDraftRemaining((current) =>
      current === String(displayed) ? current : String(displayed)
    );
  }, [
    isEditing,
    optimisticRemaining,
    sessionPack?.remainingSessions,
  ]);

  // Focus the integer input when entering edit mode.
  useEffect(() => {
    if (isEditing) {
      // Defer so the input has mounted.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isEditing]);

  // Once the Convex subscription reports a remaining value that
  // matches our optimistic write, drop the override so the UI
  // tracks the server as the source of truth again. Otherwise an
  // out-of-band update (e.g. expiry job) would be masked.
  useEffect(() => {
    if (
      optimisticRemaining !== null &&
      sessionPack &&
      sessionPack.remainingSessions === optimisticRemaining
    ) {
      setOptimisticRemaining(null);
    }
  }, [optimisticRemaining, sessionPack?.remainingSessions, sessionPack]);

  const remainingSessions =
    optimisticRemaining ?? sessionPack?.remainingSessions ?? 0;
  const totalSessions = sessionPack?.totalSessions ?? 0;

  const handleStartEdit = useCallback(() => {
    if (!sessionPack) return;
    // Seed from the displayed value so a freshly-saved optimistic
    // override isn't immediately overwritten when the user re-enters
    // edit mode before Convex confirms.
    const displayed = optimisticRemaining ?? sessionPack.remainingSessions;
    setDraftRemaining(String(displayed));
    setIsEditing(true);
  }, [optimisticRemaining, sessionPack]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setDraftRemaining("");
  }, []);

  const saveRemaining = useCallback(async () => {
    if (!sessionPack) return;
    if (isSaving) return;
    // Strip non-integer characters, then parse.
    const cleaned = draftRemaining.replace(/[^0-9]/g, "");
    if (cleaned === "") return;
    const next = parseInt(cleaned, 10);
    if (!Number.isFinite(next) || next < 0) return;
    // Match the Save button's over-cap guard so the Enter keyboard
    // path can't silently clamp an over-cap draft to the pack total
    // (which would surprise the user — they typed "10", the server
    // saved "4"). The disabled-button state already blocks over-cap
    // saves via the click handler; Enter must do the same.
    if (next > totalSessions) return;
    const clamped = next;

    setIsSaving(true);
    try {
      const response = await fetch(
        `/api/instructor/session-packs/${sessionPackId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "set", amount: clamped }),
        }
      );
      let json: Partial<SessionPackPatchResponse> & { error?: string } = {};
      try {
        json = (await response.json()) as typeof json;
      } catch {
        // Non-JSON body, e.g. an HTML proxy error.
      }

      if (!response.ok || !json.sessionPack) {
        throw new Error(json.error || "Failed to update session count");
      }

      // The `set` API action uses `convex/sessionPacks.setRemainingSessions`,
      // which patches only `remainingSessions` (not `totalSessions`).
      // Apply the server-returned value as an optimistic override so
      // the pill updates instantly; the subscription sync effect above
      // will clear the override once Convex pushes the matching value.
      setOptimisticRemaining(json.sessionPack.remainingSessions);
      toast.success(
        `Updated to ${json.sessionPack.remainingSessions} ${pluralize(json.sessionPack.remainingSessions)}.`
      );
      setIsEditing(false);
      setDraftRemaining("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update session count"
      );
    } finally {
      setIsSaving(false);
    }
  }, [draftRemaining, isSaving, sessionPack, sessionPackId, totalSessions]);

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void saveRemaining();
      } else if (event.key === "Escape") {
        event.preventDefault();
        handleCancelEdit();
      }
    },
    [handleCancelEdit, saveRemaining]
  );

  // Filter non-integer characters as the user types. Lets the
  // user paste strings like "5 sessions" and end up with "5".
  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      const cleaned = raw.replace(/[^0-9]/g, "");
      setDraftRemaining(cleaned);
    },
    []
  );

  if (isLoading) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading sessions
      </div>
    );
  }

  if (!sessionPack) return null;

  const isOverCap =
    draftRemaining !== "" &&
    parseInt(draftRemaining, 10) > totalSessions;

  return (
    <div
      className={cn(
        "inline-flex items-center overflow-hidden rounded-full border bg-background text-sm shadow-sm",
        remainingSessions === 0 && "border-destructive/50",
        remainingSessions === 1 && "border-yellow-500/50"
      )}
      aria-label={`${remainingSessions} ${pluralize(remainingSessions)}`}
    >
      {isEditing ? (
        <>
          <div className="border-r px-3 py-1.5 font-medium text-muted-foreground">
            {totalSessions} total
          </div>
          <Input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={draftRemaining}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            disabled={isSaving}
            aria-label="New session remaining count"
            aria-invalid={isOverCap}
            className={cn(
              "h-8 w-20 rounded-none border-0 px-3 text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0",
              isOverCap && "text-destructive"
            )}
            maxLength={String(totalSessions).length + 1}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-none"
            disabled={isSaving || draftRemaining === "" || isOverCap}
            onClick={() => void saveRemaining()}
            aria-label="Save session remaining count"
            title="Save"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
          </Button>
          <div className="w-px h-6 bg-border" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-none"
            disabled={isSaving}
            onClick={handleCancelEdit}
            aria-label="Cancel"
            title="Cancel"
          >
            <X className="h-4 w-4" />
          </Button>
        </>
      ) : (
        <>
          <div className="px-3 py-1.5 font-medium">
            {remainingSessions} {pluralize(remainingSessions)}
          </div>
          <div className="w-px h-6 bg-border" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-none"
            aria-label="Edit session remaining count"
            title="Edit session remaining count"
            onClick={handleStartEdit}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );
}
