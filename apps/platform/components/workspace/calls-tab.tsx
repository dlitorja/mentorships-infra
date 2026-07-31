"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { Play, Download, Video, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getRetentionUrgency, summarizeRetention } from "@/lib/recording-retention";
import { useRecordingRetry } from "@/lib/hooks/use-recording-retry";
import { ApiRoutes } from "@/lib/routes";
import { formatDuration, summarizeTransferError } from "./calls-section";
import RecordingPlayerModal from "./recording-player-modal";

type CallRecording = FunctionReturnType<
  typeof api.sessions.getCallRecordingsForWorkspace
>["recordings"][number];

interface CallsTabProps {
  workspaceId: Id<"workspaces">;
}

/**
 * PR #video-tab: dedicated "Videos" tab for the workspace. Past call
 * recordings are surfaced as a gallery of viewable video cards, each with
 * a prominent Play button, duration, and download action. This makes the
 * recordings visible as first-class files in the workspace rather than
 * hidden in a small subsection of the Notes tab.
 *
 * Recordings remain gated by the same server-side auth as
 * `CallsSection`; the workspace instructor and owner (the student who
 * purchased the workspace) can see them. The tab is intentionally shown
 * to all roles, matching the visibility of the existing Notes tab calls
 * section, because the server returns the data for both the instructor
 * and the owner.
 */
export default function CallsTab({
  workspaceId,
}: CallsTabProps): React.ReactElement {
  const recordingsQuery = useQuery(
    convexQuery(api.sessions.getCallRecordingsForWorkspace, {
      workspaceId,
    })
  );
  const [openSessionId, setOpenSessionId] =
    useState<Id<"sessions"> | null>(null);

  if (recordingsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

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

  const recordings: CallRecording[] = recordingsQuery.data?.recordings ?? [];
  const isTruncated = recordingsQuery.data?.isTruncated ?? false;

  if (recordings.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-6 pb-6 text-center text-muted-foreground">
          <Video className="h-12 w-12 mx-auto mb-4 opacity-50" aria-hidden="true" />
          <p className="font-medium text-foreground">No videos yet</p>
          <p className="text-sm mt-1">
            Past call recordings will appear here once a call ends.
          </p>
        </CardContent>
      </Card>
    );
  }

  const openRecording = recordings.find(
    (r) => r.sessionId === openSessionId
  );

  return (
    <section aria-label="Call recordings" className="space-y-4">
      <div className="flex items-center gap-2">
        <Video
          className="h-5 w-5 text-muted-foreground"
          aria-hidden="true"
        />
        <h3 className="text-base font-semibold">Videos</h3>
        <span className="text-sm text-muted-foreground">
          ({recordings.length})
        </span>
      </div>
      {isTruncated && (
        <p className="text-xs text-muted-foreground">
          Showing the most recent recordings. Some calls may not be listed.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {recordings.map((recording) => (
          <VideoCard
            key={recording.sessionId}
            recording={recording}
            onPlay={() => setOpenSessionId(recording.sessionId)}
          />
        ))}
      </div>

      {openRecording ? (
        <RecordingPlayerModal
          sessionId={openRecording.sessionId}
          open={openSessionId !== null}
          onOpenChange={(next) => {
            if (!next) setOpenSessionId(null);
          }}
          callStartedAt={openRecording.callStartedAt}
          participantName={openRecording.participantName}
          recordingExpiresAt={openRecording.recordingExpiresAt}
        />
      ) : null}
    </section>
  );
}

interface VideoCardProps {
  recording: CallRecording;
  onPlay: () => void;
}

function VideoCard({ recording, onPlay }: VideoCardProps): React.ReactElement {
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

  const status = recording.recordingTransferStatus;
  const isReady = status === "ready" || status === null;
  const isPending = status === "pending" || status === "uploading";
  const isFailed = status === "failed";
  const isPurged = status === "purged";

  const downloadHref = `${ApiRoutes.videoRecording(recording.sessionId)}?kind=download`;
  const { retry, isPending: isRetryPending, error: retryError } =
    useRecordingRetry(recording.sessionId);
  const retryErrorMessage = retryError ? retryError.message : null;

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-video bg-muted flex items-center justify-center">
        <Video
          className="h-12 w-12 text-muted-foreground/60"
          aria-hidden="true"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/10 transition-colors">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-12 w-12 rounded-full shadow-lg"
            onClick={onPlay}
            disabled={!isReady}
            aria-label={
              isReady
                ? `Play recording from ${dateLabel}`
                : `Recording from ${dateLabel} is not yet ready`
            }
          >
            <Play className="h-6 w-6" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{dateLabel}</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground mt-1">
              {durationLabel ? <span>{durationLabel}</span> : null}
              {recording.isAdhoc ? <span>Ad-hoc call</span> : null}
              {recording.participantName ? (
                <span className="truncate">{recording.participantName}</span>
              ) : null}
            </div>
            {isReady && recording.recordingExpiresAt !== null ? (
              <p
                className={`text-xs mt-2 ${
                  getRetentionUrgency(recording.recordingExpiresAt) ===
                  "urgent"
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
              >
                {summarizeRetention(recording.recordingExpiresAt)}
              </p>
            ) : null}
          </div>
          {isReady ? (
            <Button asChild variant="outline" size="icon">
              <a
                href={downloadHref}
                download
                aria-label={`Download recording from ${dateLabel}`}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
              </a>
            </Button>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
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
            <>
              <span
                className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive"
                aria-label="Recording could not be saved; retry available"
              >
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
                Recording unavailable
              </span>
              {recording.canRetryRecording ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => retry()}
                  disabled={isRetryPending}
                  aria-label={`Retry transfer for recording from ${dateLabel}`}
                >
                  {isRetryPending ? (
                    <Loader2
                      className="h-3 w-3 mr-1 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <RefreshCw className="h-3 w-3 mr-1" aria-hidden="true" />
                  )}
                  {isRetryPending ? "Retrying…" : "Retry"}
                </Button>
              ) : null}
            </>
          ) : null}
          {isPurged ? (
            <span
              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
              aria-label="Recording was auto-deleted by retention"
            >
              Deleted{" "}
              {recording.recordingDeletedAt !== null
                ? `on ${new Date(recording.recordingDeletedAt).toLocaleDateString()}`
                : ""}
            </span>
          ) : null}
        </div>

        {isFailed && recording.recordingTransferErrorCode ? (
          <p className="text-xs text-muted-foreground mt-2">
            {summarizeTransferError(recording.recordingTransferErrorCode)}
          </p>
        ) : null}
        {retryErrorMessage ? (
          <p className="text-xs text-destructive mt-2" role="status" aria-live="polite">
            {`Retry failed: ${retryErrorMessage}`}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
