"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ConsentModalProps = {
  open: boolean;
  /**
   * Whether recording is the default. Mirrors the caller — ad-hoc
   * calls default to ON (per `docs/plans/video-calling.md:343`),
   * scheduled sessions default to the session's `recordingConsent`
   * (already captured at booking).
   */
  defaultRecording: boolean;
  /**
   * Whether the modal is being shown before starting a new ad-hoc
   * call (`start`) or joining an existing session (`join`). The copy
   * and button labels adapt to the action.
   */
  mode?: "join" | "start";
  /**
   * Called when the user explicitly chooses to proceed with or without
   * recording. The caller persists the consent value via
   * `POST /api/video/consent/[sessionId]` (join) or the
   * `recordingConsent` body param of `POST /api/video/start-adhoc`
   * (start) and then joins/starts the call.
   */
  onResolved: (consent: boolean) => void;
  /**
   * Called when the user closes the dialog without choosing (Escape,
   * backdrop click, or "Cancel" button). Aborts the pending flow —
   * no consent is persisted and the call is not joined/started.
   */
  onCancel: () => void;
};

/**
 * Recording-consent dialog opened before joining or starting a call.
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
  mode = "join",
  onResolved,
  onCancel,
}: ConsentModalProps): React.ReactElement {
  const isStartMode = mode === "start";
  const [hasChosen, setHasChosen] = useState<boolean>(false);

  useEffect(() => {
    if (open) {
      setHasChosen(false);
    }
  }, [open]);

  const choose = useCallback(
    (consent: boolean): void => {
      setHasChosen(true);
      onResolved(consent);
    },
    [onResolved]
  );

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
            conversation afterward. Recordings are stored securely and
            automatically deleted on a rolling basis. Choose what
            you&apos;re comfortable with — the other party sees the same
            choice and either of you can decline.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {defaultRecording
            ? isStartMode
              ? "Recording is on by default. You can start without recording if you prefer."
              : "Recording is on by default. You can join without recording if you prefer."
            : "Recording is off by default."}
        </p>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={hasChosen}
          >
            {isStartMode ? "Cancel" : "Don't join"}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => choose(false)}
              disabled={hasChosen}
            >
              {isStartMode ? "Start without recording" : "Join without recording"}
            </Button>
            <Button
              type="button"
              onClick={() => choose(true)}
              disabled={hasChosen}
            >
              {hasChosen
                ? "Continuing…"
                : isStartMode
                  ? "Start with recording"
                  : "Join with recording"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
