"use client";

import { useCallback, useEffect, useState } from "react";
import { Mic, VideoOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export type ConsentModalProps = {
  open: boolean;
  /**
   * Whether recording is the default. Mirrors the caller — ad-hoc
   * calls default to ON (per `docs/plans/video-calling.md:343`),
   * scheduled calls default to the session's `recordingConsent`
   * (already captured at booking).
   */
  defaultRecording: boolean;
  /**
   * Called when the user makes a choice. The caller is responsible
   * for persisting the value (either via `POST /api/video/consent/
   * [sessionId]` for an existing session, or as a body param to
   * `POST /api/video/start-adhoc` for a not-yet-created session).
   */
  onResolved: (consent: boolean) => void;
  /**
   * Called when the user closes the dialog without choosing (Escape,
   * backdrop click). Aborts the pending join flow — no consent is
   * persisted and `join()` is NOT called. The user must click the
   * Join/Retry button again to re-open the modal and make a choice.
   * This is intentionally different from picking "Don't record":
   * cancel is a pure dismiss, while "Don't record" submits `false`
   * through the same persistence path as a `true` confirmation.
   */
  onCancel: () => void;
};

/**
 * Recording-consent dialog opened before joining (or starting) a call.
 *
 * This modal is presentational only — it captures the user's choice
 * and hands it back to the caller. Persistence is the caller's job:
 *   - Existing session (Join Call scheduled): caller calls
 *     `POST /api/video/consent/[sessionId]` to persist before
 *     triggering `markCallStarted` + `call.join`.
 *   - New ad-hoc session (Start ad-hoc button): caller passes the
 *     choice as the `recordingConsent` body param of
 *     `POST /api/video/start-adhoc`. No separate persistence step
 *     because the session row doesn't exist yet.
 *
 * Why a single boolean (not per-participant in the modal):
 *   The modal collects THIS USER's personal consent choice (true or
 *   false). The server combines each party's choice with AND
 *   semantics (see `recordConsent` in convex/sessions.ts) — if
 *   either party has submitted `false`, recording is disabled for
 *   the call. Daily's `enable_recording` is a room-level flag, so
 *   the combined value is what gets reconciled to Daily.
 */
export function ConsentModal({
  open,
  defaultRecording,
  onResolved,
  onCancel,
}: ConsentModalProps): React.ReactElement {
  const [recordConsent, setRecordConsent] = useState<boolean>(defaultRecording);
  const [hasChosen, setHasChosen] = useState<boolean>(false);

  // Reset internal state whenever the modal re-opens. Without this,
  // `hasChosen` stays `true` from the previous open and the action
  // buttons remain permanently disabled — breaking any retry path
  // (CallStatusPill error → Retry, scheduled re-join after the call
  // ends, etc.). The component is mounted once per parent so we have
  // to react to `open` flipping rather than remounting on each open.
  useEffect(() => {
    if (open) {
      setRecordConsent(defaultRecording);
      setHasChosen(false);
    }
  }, [defaultRecording, open]);

  const choose = useCallback(
    (consent: boolean): void => {
      setHasChosen(true);
      onResolved(consent);
    },
    [onResolved]
  );

  const handleConfirm = (): void => {
    choose(recordConsent);
  };
  const handleDecline = (): void => {
    choose(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !hasChosen) {
          onCancel();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Recording consent</DialogTitle>
          <DialogDescription>
            This call can be recorded so both parties can revisit the
            conversation afterward. Recording is stored in Backblaze B2
            with the same retention as scheduled sessions. Choose what
            you&apos;re comfortable with — the other party sees the same
            choice and either of you can decline.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3">
          <div className="flex items-center gap-2">
            {recordConsent ? (
              <Mic className="h-4 w-4 text-emerald-600" />
            ) : (
              <VideoOff className="h-4 w-4 text-muted-foreground" />
            )}
            <Label htmlFor="record-consent" className="text-sm font-medium">
              Record this call
            </Label>
          </div>
          <Switch
            id="record-consent"
            checked={recordConsent}
            onCheckedChange={setRecordConsent}
            disabled={hasChosen}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {recordConsent
            ? "Recording is on. The other party will be notified when they join."
            : "Recording is off. The other party will not see a recording in their Notes tab after this call."}
        </p>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleDecline}
            disabled={hasChosen}
          >
            Don&apos;t record
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={hasChosen}
          >
            {hasChosen ? "Continuing…" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
