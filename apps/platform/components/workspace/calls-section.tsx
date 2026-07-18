"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { Play, Download, Video, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import RecordingPlayerModal from "./recording-player-modal";

type CallRecording = FunctionReturnType<
  typeof api.sessions.getCallRecordingsForWorkspace
>[number];

type TransferStatus = CallRecording["recordingTransferStatus"];

/**
 * PR #4c-1 + video-recording-to-b2: Calls sub-section at the top of
 * the Notes tab. Lists every past call recording the caller can see
 * for this workspace, with Play (modal player) and Download (signed
 * B2 URL via the route layer) actions.
 *
 * Reads from `api.sessions.getCallRecordingsForWorkspace` which
 * already enforces auth (instructor OR owner on the workspace),
 * so we don't gate at the component level — the server is the
 * source of truth.
 *
 * The Download button is a plain anchor — the browser handles
 * the `Content-Disposition: attachment` from the route, so the
 * file saves with the date-based filename the route generates.
 *
 * Transfer status (video-recording-to-b2): when a recording is
 * `pending`/`uploading` (Daily → B2 transfer in flight) or `failed`
 * (terminal — surface a retry button), Play/Download are gated off
 * and the row shows a status pill. The retry button calls the
 * instructor-only `/api/video/recording/{sessionId}/retry`
 * endpoint, which re-triggers the Trigger.dev transfer task with a
 * fresh idempotency key.
 */
interface CallsSectionProps {
  workspaceId: Id<"workspaces">;
}

export default function CallsSection({
  workspaceId,
}: CallsSectionProps): React.ReactElement {
  const recordingsQuery = useQuery(
    convexQuery(api.sessions.getCallRecordingsForWorkspace, {
      workspaceId,
    })
  );
  const [openSessionId, setOpenSessionId] =
    useState<Id<"sessions"> | null>(null);

  if (recordingsQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading recordings…
      </div>
    );
  }

  // Greptile R4 P4 / GitHub App: distinguish an actual query error
  // from a legitimate empty list. Previously a 403/500 from
  // `getCallRecordingsForWorkspace` surfaced as "no recordings
  // yet" — confusing for users (and masking real auth failures).
  //
  // CodeRabbit R5: don't surface the raw error message to the
  // user — it can leak server-side details (token errors, Convex
  // URLs, internal exception messages). Use a generic message;
  // the detailed reason is already in the server-side
  // observability layer.
  if (recordingsQuery.isError) {
    return (
      <section
        aria-label="Call recordings"
        className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive space-y-2"
      >
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <span className="font-medium">Couldn&apos;t load recordings</span>
        </div>
        <p className="text-xs">
          Something went wrong loading the recordings list. Try again in a
          moment.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => recordingsQuery.refetch()}
        >
          <RefreshCw className="h-4 w-4 mr-1" aria-hidden="true" />
          Retry
        </Button>
      </section>
    );
  }

  // CodeRabbit R5: the previous `as CallRecording[]` cast was a
  // hand-rolled type mirror that drifted from the actual query
  // return shape. We use the inferred type from
  // `recordingsQuery.data ?? []` so any future shape change in
  // `getCallRecordingsForWorkspace` surfaces as a tsc error here
  // instead of silently being masked by the cast.
  const recordings: CallRecording[] = recordingsQuery.data ?? [];

  if (recordings.length === 0) {
    return (
      <section
        aria-label="Call recordings"
        className="rounded-md border border-dashed p-3 text-sm text-muted-foreground"
      >
        <div className="flex items-center gap-2">
          <Video className="h-4 w-4" aria-hidden="true" />
          <span className="font-medium text-foreground">Calls</span>
        </div>
        <p className="mt-1 pl-6">
          No recordings yet — recordings appear here after a call ends.
        </p>
      </section>
    );
  }

  // Only the most-recent recording can have the modal open at any
  // time. We pick the matching row from the list so the modal
  // receives a `CallRecording`-shaped object whose `callStartedAt`
  // / `participantName` are guaranteed consistent with the row
  // the user clicked on.
  const openRecording = recordings.find(
    (r) => r.sessionId === openSessionId
  );

  return (
    <section
      aria-label="Call recordings"
      className="rounded-md border bg-card p-3 space-y-2"
    >
      <div className="flex items-center gap-2 px-1">
        <Video className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-semibold">Calls</h3>
        <span className="text-xs text-muted-foreground">
          ({recordings.length})
        </span>
      </div>

      <ul className="divide-y">
        {recordings.map((recording) => (
          <RecordingRow
            key={recording.sessionId}
            recording={recording}
            onPlay={() => setOpenSessionId(recording.sessionId)}
          />
        ))}
      </ul>

      {openRecording ? (
        <RecordingPlayerModal
          sessionId={openRecording.sessionId}
          open={openSessionId !== null}
          onOpenChange={(next) => {
            if (!next) setOpenSessionId(null);
          }}
          callStartedAt={openRecording.callStartedAt}
          participantName={openRecording.participantName}
        />
      ) : null}
    </section>
  );
}

interface RecordingRowProps {
  recording: CallRecording;
  onPlay: () => void;
}

function RecordingRow({
  recording,
  onPlay,
}: RecordingRowProps): React.ReactElement {
  const queryClient = useQueryClient();
  const dateLabel = recording.callStartedAt
    ? new Date(recording.callStartedAt).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    })
    : "Date unavailable";
  const durationLabel =
    recording.recordingDurationSeconds !== null
      ? formatDuration(recording.recordingDurationSeconds)
      : null;
  const subtitleParts = [
    recording.isAdhoc ? "Ad-hoc call" : null,
    recording.participantName,
    durationLabel,
  ].filter(Boolean);

  const status = recording.recordingTransferStatus;
  const isReady = status === "ready" || status === null;
  const isPending = status === "pending" || status === "uploading";
  const isFailed = status === "failed";

  const downloadHref = `/api/video/recording/${recording.sessionId}?kind=download`;

  const retryMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      const response = await fetch(
        `/api/video/recording/${recording.sessionId}/retry`,
        {
          method: "POST",
          credentials: "include",
        }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(
          body?.error ?? `Retry failed (HTTP ${response.status})`
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["recordings", String(recording.sessionId)],
      });
    },
  });

  const retryErrorMessage =
    retryMutation.error instanceof Error
      ? retryMutation.error.message
      : retryMutation.error
        ? "Retry failed"
        : null;

  return (
    <li className="flex items-center gap-3 py-2 px-1">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate flex items-center gap-2">
          <span>{dateLabel}</span>
          {isPending ? (
            <span
              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
              aria-label="Recording is being saved to storage"
            >
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Processing
              {recording.recordingTransferAttempts !== null &&
                recording.recordingTransferAttempts > 0
                ? ` (attempt ${recording.recordingTransferAttempts}/5)`
                : ""}
            </span>
          ) : null}
          {isFailed ? (
            <span
              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive"
              aria-label="Recording could not be saved; retry available"
            >
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              Recording unavailable
            </span>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {subtitleParts.join(" · ")}
        </div>
        {isFailed && recording.recordingTransferErrorCode ? (
          <p className="text-xs text-muted-foreground mt-1 max-w-md">
            {summarizeTransferError(recording.recordingTransferErrorCode)}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onPlay}
          disabled={!isReady}
          aria-label={
            isReady
              ? `Play recording from ${dateLabel}`
              : `Recording from ${dateLabel} is not yet ready`
          }
        >
          <Play className="h-4 w-4 mr-1" aria-hidden="true" />
          Play
        </Button>
        {isReady ? (
          <Button asChild variant="outline" size="sm">
            <a
              href={downloadHref}
              download
              aria-label={`Download recording from ${dateLabel}`}
            >
              <Download className="h-4 w-4 mr-1" aria-hidden="true" />
              Download
            </a>
          </Button>
        ) : isFailed && recording.canRetryRecording ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => retryMutation.mutate()}
            disabled={retryMutation.isPending}
            aria-label={`Retry transfer for recording from ${dateLabel}`}
          >
            {retryMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" aria-hidden="true" />
            )}
            {retryMutation.isPending ? "Retrying…" : "Retry transfer"}
          </Button>
        ) : null}
      </div>
      {retryErrorMessage ? (
        <div className="basis-full">
          <p
            className="text-xs text-destructive mt-1"
            role="status"
            aria-live="polite"
          >
            {`Retry failed: ${retryErrorMessage}`}
          </p>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Maps a server-derived `recordingTransferErrorCode` to a
 * user-facing one-liner. The raw error string is intentionally
 * NOT returned to the client (CodeRabbit review flagged that the
 * prior tooltip text could leak presigned URLs, B2 endpoint
 * diagnostics, or other provider internals); the Convex query
 * classifies the raw message into one of these four buckets.
 *
 * Most common causes in production:
 *   - Daily auto-purged the recording (>7 days old) → `daily_purged`
 *   - B2 credentials missing or rotated → `storage`
 *   - Transient network blip on the Trigger task → `network`
 *   - Anything else → `unknown`
 */
function summarizeTransferError(
  code: NonNullable<CallRecording["recordingTransferErrorCode"]>
): string {
  switch (code) {
    case "daily_purged":
      return "Daily purged this recording before the transfer ran. Retrying won't help — please contact support.";
    case "storage":
      return "Could not save to storage. Click retry; if it keeps failing, contact support.";
    case "network":
      return "Network blip during transfer. Click retry to try again.";
    case "unknown":
    default:
      return "Something went wrong saving the recording. Click retry; if it keeps failing, contact support.";
  }
}

function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "0:00";
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}
