"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { Play, Download, Video, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { CallRecording } from "../../../../convex/sessions";
import { Button } from "@/components/ui/button";
import RecordingPlayerModal from "./recording-player-modal";

/**
 * PR #4c-1: Calls sub-section at the top of the Notes tab.
 * Lists every past call recording the caller can see for this
 * workspace, with Play (modal player) and Download (signed B2
 * URL via the route layer) actions.
 *
 * Reads from `api.sessions.getCallRecordingsForWorkspace` which
 * already enforces auth (instructor OR owner on the workspace),
 * so we don't gate at the component level — the server is the
 * source of truth.
 *
 * The Download button is a plain anchor — the browser handles
 * the `Content-Disposition: attachment` from the route, so the
 * file saves with the date-based filename the route generates.
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

  const recordings = (recordingsQuery.data ?? []) as CallRecording[];

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
  const downloadHref = `/api/video/recording/${recording.sessionId}?kind=download`;
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

  return (
    <li className="flex items-center gap-3 py-2 px-1">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{dateLabel}</div>
        <div className="text-xs text-muted-foreground truncate">
          {subtitleParts.join(" · ")}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onPlay}
          aria-label={`Play recording from ${dateLabel}`}
        >
          <Play className="h-4 w-4 mr-1" aria-hidden="true" />
          Play
        </Button>
        <Button
          asChild
          variant="outline"
          size="sm"
        >
          <a
            href={downloadHref}
            download
            aria-label={`Download recording from ${dateLabel}`}
          >
            <Download className="h-4 w-4 mr-1" aria-hidden="true" />
            Download
          </a>
        </Button>
      </div>
    </li>
  );
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
