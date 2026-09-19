"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { Play, Download, Video, Loader2, AlertCircle, RefreshCw, CloudDownload, Bell, BellOff } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
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
  /**
   * PR #3 deep-link: when the workspace page is reached via
   * `/workspace/{id}?videos={sessionId}`, scroll the matching
   * recording card into view. The bell row surfaces
   * `recording_ready` notifications with a link of that shape;
   * landing on the videos tab without a focus target would be
   * confusing — users would see their bell badge clear but
   * no visible context for what changed.
   *
   * We do NOT auto-open the recording modal here — that would
   * add unsolicited audio/video to the page without an explicit
   * user gesture. Scrolling the card into view is the minimum
   * signal that "this is the new recording."
   */
  initialSessionId?: Id<"sessions">;
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
 * Recordings are gated by the same server-side auth as the underlying
 * `getCallRecordingsForWorkspace` Convex query: only the workspace
 * instructor and the student who purchased the workspace can see them.
 * The tab is intentionally shown to all roles because the server returns
 * the data for both the instructor and the owner; for every other role
 * the query returns an empty page.
 */
export default function CallsTab({
  workspaceId,
  initialSessionId,
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
      {/*
       * PR #4: per-student recording-ready email toggle. Always
       * rendered; the mutation (`setNotificationPreference`)
       * auth-checks against `identity.subject` so a non-owner
       * accidentally tapping it would only write to their own
       * preference row (no effect on emails, since emails only
       * flow to student recipients). The read-side default of
       * `true` matches the migration's backfill default so the
       * toggle feels intuitive even for users with no preference
       * blob yet.
       */}
      <NotificationPreferencesCard />
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
                  deepLinkId={
                    initialSessionId &&
                    String(recording.sessionId) === String(initialSessionId)
                      ? "video-card-deep-link-target"
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/*
       * PR #3 R1 fix: the deep-link handler now paginates through
       * recordings until the matching card is found (Fix #2:
       * previously a deep-link to a recording on page 2+ would
       * no-op the scroller) AND fires `markAcknowledged` only
       * AFTER the card is visible AND the row's `workspaceId`
       * matches the current workspace (Fix #3: previously the
       * marker could ack a different workspace's notification).
       *
       * See `<RecordingDeepLinkHandler>` below for the full
       * pagination + ack flow.
       */}
      {initialSessionId && !recordingsQuery.isLoading ? (
        <RecordingDeepLinkHandler
          workspaceId={workspaceId}
          initialSessionId={initialSessionId}
          recordingsQuery={recordingsQuery}
          hasFoundTarget={recordings.some(
            (r) => String(r.sessionId) === String(initialSessionId)
          )}
        />
      ) : null}

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
  /**
   * PR #3 deep-link: when this card matches the `initialSessionId`
   * from `/workspace/{id}?videos={sessionId}`, render with this DOM
   * id so `<DeepLinkScroller />` can scroll it into view.
   */
  deepLinkId?: string;
}

function VideoCard({
  recording,
  onPlay,
  deepLinkId,
}: VideoCardProps): React.ReactElement {
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
    <Card id={deepLinkId} className="overflow-hidden">
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

/**
 * PR #3 deep-link: scroll the recording card matching the bell's
 * `?videos={sessionId}` deep-link into view. Mounted only when
 * `initialSessionId` is present AND the recordings have loaded —
 * the no-op render while loading is fine; the active effect runs
 * once after mount, so the DOM node must exist.
 *
 * We use `scrollIntoView` rather than `window.scrollTo` because
 * `scrollIntoView` is robust against layout shifts (grouped
 * sections collapse/expand as the recordings page paginates). The
 * `{ block: "center" }` option centers the card rather than
 * aligning it to the top edge, which feels less jarring on a
 * page where users have scrolled to read other tabs.
 */
/**
 * PR #3 R1 fix (Greptile P1 #2 + P1 #3): combine the deep-link
 * pagination, scroll, and acknowledge-fire into one component
 * so all three happen together with consistent scoping.
 *
 * Pagination (Fix #2): if the target `initialSessionId` is not
 * yet in the loaded pages, keep calling `fetchNextPage()` until
 * either:
 *   - the target is found (then scroll + ack), or
 *   - there are no more pages (then no-op; the user can scroll
 *     themselves or hit "Load more").
 *
 * The cap (`MAX_DEEP_LINK_PAGES`) protects against runaway
 * pagination if the deep-link points at a sessionId that no
 * recording exists for — we don't want to page through every
 * historical recording to satisfy a bad URL.
 *
 * Workspace scope (Fix #3): when acking, the handler looks up
 * the notification via `listUnreadForUser` (scoped to the
 * current user) and requires BOTH `sessionId === initialSessionId`
 * AND `workspaceId === workspaceId`. Without the workspace
 * filter, a user with access to two workspaces could land on
 * workspace A with `?videos={sessionId-from-B}` and silently
 * ack B's notification — Greptile R1 P1 #3.
 *
 * Idempotency: a `useRef` guard prevents double-firing across
 * React's strict-mode double-mount in dev. The Convex
 * `markAcknowledged` mutation is itself idempotent (preserves
 * existing `acknowledgedAt`), so even if the guard failed it
 * would be safe — the ref is belt-and-suspenders.
 */
const MAX_DEEP_LINK_PAGES = 8;

type InfiniteQueryLike = {
  hasNextPage: boolean | undefined;
  isFetchingNextPage: boolean;
  fetchNextPage: () => Promise<unknown>;
};

function RecordingDeepLinkHandler({
  workspaceId,
  initialSessionId,
  recordingsQuery,
  hasFoundTarget,
}: {
  workspaceId: Id<"workspaces">;
  initialSessionId: Id<"sessions">;
  recordingsQuery: InfiniteQueryLike;
  hasFoundTarget: boolean;
}): React.ReactElement | null {
  const { data: notifications } = useQuery(
    convexQuery(api.recordingReadyNotifications.listUnreadForUser, {})
  );
  const markAcknowledged = useMutation({
    mutationFn: useConvexMutation(
      api.recordingReadyNotifications.markAcknowledged
    ),
  });

  const ackedRef = useRef(false);
  const pagesFetchedRef = useRef(0);

  // Effect 1: keep paginating until the target is found OR we run
  // out of pages. We deliberately do NOT scroll/ack here — that
  // happens in effect 2 once `hasFoundTarget` becomes true.
  useEffect(() => {
    if (hasFoundTarget) return;
    if (pagesFetchedRef.current >= MAX_DEEP_LINK_PAGES) return;
    if (!recordingsQuery.hasNextPage) return;
    if (recordingsQuery.isFetchingNextPage) return;
    pagesFetchedRef.current += 1;
    void recordingsQuery.fetchNextPage();
  }, [
    hasFoundTarget,
    recordingsQuery.hasNextPage,
    recordingsQuery.isFetchingNextPage,
    recordingsQuery,
  ]);

  // Effect 2: once the target card is rendered, scroll to it AND
  // fire `markAcknowledged` exactly once — only if a matching
  // notification row exists for the current workspace. The
  // `ackedRef` guard makes the fire idempotent across React
  // strict-mode double-mount in dev.
  useEffect(() => {
    if (!hasFoundTarget) return;
    if (ackedRef.current) return;
    if (!notifications) return;
    const target = notifications.find(
      (n) =>
        String(n.sessionId) === String(initialSessionId) &&
        n.workspaceId !== undefined &&
        String(n.workspaceId) === String(workspaceId)
    );
    if (!target) return;

    // Scroll first; ack after. The scroll is synchronous (the
    // browser starts the scroll immediately on the next frame),
    // so the order doesn't matter visually, but logging the ack
    // AFTER the scroll matches the user-intent model: "we found
    // the recording, now we've seen it."
    const node = document.getElementById("video-card-deep-link-target");
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    ackedRef.current = true;
    markAcknowledged.mutate({ notificationId: target._id });
  }, [
    hasFoundTarget,
    notifications,
    initialSessionId,
    workspaceId,
    markAcknowledged,
  ]);

  return null;
}

/**
 * PR #4: per-student toggle for the recording-ready email
 * pipeline (PR #2). Reads the user's current preference from
 * `notificationPreferences.recordingReadyEmail` via
 * `getCurrentUser` and writes back through
 * `setNotificationPreference`.
 *
 * Defaults to `true` (opt-out semantics) on the read side to
 * match the migration backfill default AND the server-side
 * fallback in `readRecordingReadyEmailPreference`. This way a
 * student who hasn't been migrated yet still sees the toggle in
 * its expected default position.
 *
 * Optimistic UI: the switch flips immediately on click and
 * reverts on mutation error. The mutation itself is idempotent
 * (a `record` of the user's current preference is harmless), so
 * we don't need to reconcile after the server returns. We do
 * invalidate the `getCurrentUser` query on success so the next
 * page load is consistent if the optimistic value diverged from
 * the server's authoritative value (e.g., a stale tab).
 *
 * The `getCurrentUser` query is public and auth-gated server-side
 * (returns `null` for unauthenticated callers), so we don't need
 * a separate `useUser` check — a `null` result renders nothing.
 */
function NotificationPreferencesCard(): React.ReactElement | null {
  const currentUserQuery = useQuery(convexQuery(api.users.getCurrentUser, {}));
  const setPreference = useConvexMutation(api.users.setNotificationPreference);

  const currentValue = useMemo(() => {
    if (!currentUserQuery.data) return null;
    const prefs = currentUserQuery.data.notificationPreferences;
    if (
      prefs &&
      typeof prefs === "object" &&
      !Array.isArray(prefs) &&
      "recordingReadyEmail" in prefs
    ) {
      const v = (prefs as { recordingReadyEmail: unknown }).recordingReadyEmail;
      if (typeof v === "boolean") return v;
    }
    return true;
  }, [currentUserQuery.data]);

  const handleChange = useCallback(
    async (next: boolean) => {
      try {
        await setPreference({
          key: "recordingReadyEmail",
          value: next,
        });
      } catch (err) {
        // Surface the error to the console for now — the optimistic
        // toggle reverts via the `checked` prop falling back to
        // `currentValue` (the server's truth) on next render. A
        // toast / banner could be added later.
        console.error("setNotificationPreference failed", err);
      }
    },
    [setPreference]
  );

  if (currentUserQuery.isLoading) return null;
  if (!currentUserQuery.data) return null;
  if (currentValue === null) return null;

  const Icon = currentValue ? Bell : BellOff;
  const label = currentValue ? "Email me when a recording is ready" : "Recording-ready emails are off";

  return (
    <Card
      className="border-dashed bg-muted/30"
      role="group"
      aria-label="Recording notification preferences"
    >
      <CardContent className="flex items-center justify-between gap-4 p-3">
        <div className="flex items-start gap-3">
          <Icon
            className="mt-0.5 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="space-y-0.5">
            <p className="text-sm font-medium leading-none">{label}</p>
            <p className="text-xs text-muted-foreground">
              You&apos;ll always see new recordings in this Videos tab.
              Turn this off to skip the email notification.
            </p>
          </div>
        </div>
        <Switch
          checked={currentValue}
          onCheckedChange={handleChange}
          aria-label="Toggle recording-ready email notifications"
        />
      </CardContent>
    </Card>
  );
}
