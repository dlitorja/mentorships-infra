"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { Play, Download, Video, Loader2, AlertCircle, RefreshCw, CloudDownload } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getRetentionUrgency, summarizeRetention } from "@/lib/recording-retention";
import { useRecordingRetry } from "@/lib/hooks/use-recording-retry";
import { ApiRoutes } from "@/lib/routes";
import { z } from "zod";
import { convexQueryClient } from "@/lib/providers/query-provider";
import { formatDuration, summarizeTransferError } from "./calls-section";
import RecordingPlayerModal from "./recording-player-modal";

const syncErrorResponseSchema = z.object({ error: z.string() }).partial();
const syncSuccessResponseSchema = z.object({
  synced: z.number(),
  checked: z.number(),
});

type CallRecording = FunctionReturnType<
  typeof api.sessions.getCallRecordingsForWorkspace
>["page"][number];
type CallRecordingPage = FunctionReturnType<
  typeof api.sessions.getCallRecordingsForWorkspace
>;

const RECORDINGS_PAGE_SIZE = 25;

interface CallsTabProps {
  workspaceId: Id<"workspaces">;
}

const SYNC_COOLDOWN_MS = 5 * 60 * 1000;

function getLastSyncKey(workspaceId: Id<"workspaces">): string {
  return `workspace-video-last-sync-${workspaceId}`;
}

function getLastSyncTimestamp(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

function setLastSyncTimestamp(key: string, timestamp: number): void {
  try {
    localStorage.setItem(key, String(timestamp));
  } catch {
    // localStorage may be unavailable (private mode, SSR, etc.);
    // in that case we simply skip the cooldown and let the effect retry.
  }
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getDateLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  if (isSameDay(date, now)) return "Today";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(date, yesterday)) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function groupRecordingsByDate(
  recordings: CallRecording[]
): Array<{ label: string; recordings: CallRecording[] }> {
  const groups = new Map<string, CallRecording[]>();
  for (const recording of recordings) {
    const label = recording.callStartedAt
      ? getDateLabel(recording.callStartedAt)
      : "Date unavailable";
    const existing = groups.get(label) ?? [];
    existing.push(recording);
    groups.set(label, existing);
  }
  return Array.from(groups.entries()).map(([label, recs]) => ({
    label,
    recordings: recs,
  }));
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
  const queryClient = useQueryClient();
  const recordingsQuery = useInfiniteQuery({
    queryKey: convexQuery(
      api.sessions.getCallRecordingsForWorkspace,
      {
        workspaceId,
        paginationOpts: { numItems: RECORDINGS_PAGE_SIZE, cursor: null },
      }
    ).queryKey,
    queryFn: async (ctx) => {
      if (!convexQueryClient) {
        throw new Error("ConvexQueryClient not initialized");
      }
      const opts = convexQueryClient.queryOptions(
        api.sessions.getCallRecordingsForWorkspace,
        {
          workspaceId,
          paginationOpts: {
            numItems: RECORDINGS_PAGE_SIZE,
            cursor: (ctx.pageParam ?? null) as string | null,
          },
        }
      );
      const fn = opts.queryFn;
      if (typeof fn !== "function") {
        throw new Error("ConvexQueryClient.queryOptions returned no queryFn");
      }
      return fn(ctx) as Promise<CallRecordingPage>;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: CallRecordingPage) =>
      lastPage.isDone ? undefined : lastPage.continueCursor,
  });
  const canSyncQuery = useQuery(
    convexQuery(api.sessions.canSyncRecordingsForWorkspace, { workspaceId })
  );
  const syncMutation = useMutation({
    mutationFn: async (variables: { workspaceId: Id<"workspaces"> }) => {
      const res = await fetch("/api/video/recordings/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: variables.workspaceId }),
      });
      const raw = await res.json();
      if (!res.ok) {
        const parsed = syncErrorResponseSchema.safeParse(raw);
        throw new Error(parsed.success ? parsed.data.error ?? "Sync failed" : "Sync failed");
      }
      const parsed = syncSuccessResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error("Sync response was malformed");
      }
      return parsed.data;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === "convexQuery" &&
          q.queryKey[1] === api.sessions.getCallRecordingsForWorkspace,
      });
      const lastSyncKey = getLastSyncKey(variables.workspaceId);
      setLastSyncTimestamp(lastSyncKey, Date.now());
    },
  });
  const [openSessionId, setOpenSessionId] =
    useState<Id<"sessions"> | null>(null);

  const showSyncButton = canSyncQuery.data === true;

  // Auto-sync recordings when the Videos tab is first viewed for a
  // workspace, but only once per workspace per 5-minute window to avoid
  // hammering the Daily API. The manual sync button remains available.
  // `workspaceId` is passed as a mutation variable so `onSuccess` always
  // invalidates and records the cooldown for the workspace that was synced,
  // even if the workspace changes while the request is in flight.
  useEffect(() => {
    if (!showSyncButton) return;
    if (syncMutation.isPending) return;

    const lastSyncKey = getLastSyncKey(workspaceId);
    const lastSync = getLastSyncTimestamp(lastSyncKey);
    if (lastSync && Date.now() - lastSync < SYNC_COOLDOWN_MS) {
      return;
    }

    syncMutation.mutate({ workspaceId });
  }, [workspaceId, showSyncButton, syncMutation]);

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

  const seen = new Set<Id<"sessions">>();
  const recordings: CallRecording[] = [];
  for (const page of recordingsQuery.data?.pages ?? []) {
    for (const recording of page.page) {
      if (seen.has(recording.sessionId)) continue;
      seen.add(recording.sessionId);
      recordings.push(recording);
    }
  }
  const hasNextPage = recordingsQuery.hasNextPage ?? false;
  const groupedRecordings = groupRecordingsByDate(recordings);

  // Greptile R5 P2 (calls-tab.tsx:257): an empty filtered slice with
  // `hasNextPage` still set means the cursor advanced past recordings
  // that belong to OTHER workspaces in the same instructor x student
  // pair. If we early-return the empty state the user never gets the
  // "Load more" button — older recordings for THIS workspace remain
  // unreachable. Render the empty state only when the cursor is
  // actually exhausted; otherwise let the Load more control below
  // surface so the user can advance the cursor themselves.
  if (recordings.length === 0 && !hasNextPage) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-6 pb-6 text-center text-muted-foreground">
          <Video className="h-12 w-12 mx-auto mb-4 opacity-50" aria-hidden="true" />
          <p className="font-medium text-foreground">No videos yet</p>
          <p className="text-sm mt-1">
            Past call recordings will appear here once a call ends.
          </p>
          {showSyncButton && (
            <div className="mt-4 flex flex-col items-center gap-2">
              <SyncButton
                onSync={() => syncMutation.mutate({ workspaceId })}
                isPending={syncMutation.isPending}
                error={syncMutation.error?.message ?? null}
              />
              {syncMutation.isSuccess && (
                <p className="text-xs text-muted-foreground">
                  Sync checked {syncMutation.data?.checked ?? 0} sessions and
                  attached {syncMutation.data?.synced ?? 0} recording
                  {(syncMutation.data?.synced ?? 0) === 1 ? "" : "s"}.
                </p>
              )}
            </div>
          )}
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
        {showSyncButton && (
          <SyncButton
            onSync={() => syncMutation.mutate({ workspaceId })}
            isPending={syncMutation.isPending}
            error={syncMutation.error?.message ?? null}
          />
        )}
      </div>
      {syncMutation.isSuccess && (
        <p className="text-xs text-muted-foreground">
          Sync checked {syncMutation.data?.checked ?? 0} sessions and attached{" "}
          {syncMutation.data?.synced ?? 0} recording
          {(syncMutation.data?.synced ?? 0) === 1 ? "" : "s"}.
        </p>
      )}
      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => recordingsQuery.fetchNextPage()}
            disabled={recordingsQuery.isFetchingNextPage}
            aria-label="Load more recordings"
          >
            {recordingsQuery.isFetchingNextPage ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" />
            ) : null}
            {recordingsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      <div className="space-y-6">
        {groupedRecordings.map((group) => (
          <div key={group.label} className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">
              {group.label}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {group.recordings.map((recording) => (
                <VideoCard
                  key={recording.sessionId}
                  recording={recording}
                  onPlay={() => setOpenSessionId(recording.sessionId)}
                />
              ))}
            </div>
          </div>
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

interface SyncButtonProps {
  onSync: () => void;
  isPending: boolean;
  error: string | null;
}

function SyncButton({ onSync, isPending, error }: SyncButtonProps): React.ReactElement {
  return (
    <div className="ml-auto flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onSync}
        disabled={isPending}
        aria-label="Sync recordings from Daily.co"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" />
        ) : (
          <CloudDownload className="h-4 w-4 mr-1" aria-hidden="true" />
        )}
        {isPending ? "Syncing…" : "Sync recordings"}
      </Button>
      {error ? (
        <span className="text-xs text-destructive" role="status" aria-live="polite">
          {error}
        </span>
      ) : null}
    </div>
  );
}
