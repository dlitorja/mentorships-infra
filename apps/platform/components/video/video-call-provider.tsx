"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DailyProvider } from "@daily-co/daily-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { reportError } from "@/lib/observability";

import { VideoCallContext, type VideoCallContextValue } from "@/lib/video/video-context";
import { useCurrentOrUpcomingSessionForWorkspace } from "@/lib/hooks/use-active-session";
import { useVideoCall } from "@/lib/hooks/use-video-call";
import { useKeyboardShortcuts } from "@/lib/hooks/use-keyboard-shortcuts";

const JOIN_WINDOW_BEFORE_MS = 15 * 60 * 1000;
const JOIN_WINDOW_AFTER_MS = 4 * 60 * 60 * 1000;

/**
 * PR #4c-2: derives the `CurrentOrUpcomingSession` shape that
 * `useCurrentOrUpcomingSessionForWorkspace` returns, but starting
 * from a raw `sessions` doc that we looked up directly via
 * `api.sessions.getSessionById`. Used to wire `useVideoCall` to
 * the deep-link target session even when the workspace's "current"
 * session differs.
 *
 * Mirrors the priority logic in `convex/sessions.ts`:
 *   1. `callEndedAt !== undefined` → return null (session ended).
 *   2. `callStartedAt !== undefined` AND `videoRoomName !== undefined` → "active".
 *   3. Otherwise, status is "joinable" when within the join window
 *      around `scheduledAt`, "scheduled" otherwise.
 *
 * `participantName` is left empty because resolving it requires a
 * server-side query; the deep-link UI doesn't display it for
 * active call surfaces (`CallStatusPill` doesn't render the
 * counterpart name), and the only consumer is the recording
 * playback modal which already has the workspace context.
 */
function deriveCurrentOrUpcomingSession(raw: Doc<"sessions">): {
  sessionId: Id<"sessions">;
  scheduledAt: number;
  status: "active" | "joinable" | "scheduled";
  startedAt: number | null;
  videoRoomName: string | null;
  videoRoomUrl: string | null;
  participantName: string;
  windowOpensAt: number;
  windowClosesAt: number;
  recordingConsent: boolean | null;
} | null {
  if (raw.callEndedAt !== undefined) return null;
  const now = Date.now();
  const windowOpensAt = raw.scheduledAt - JOIN_WINDOW_BEFORE_MS;

  if (raw.callStartedAt !== undefined && raw.videoRoomName !== undefined) {
    return {
      sessionId: raw._id,
      scheduledAt: raw.scheduledAt,
      status: "active",
      startedAt: raw.callStartedAt,
      videoRoomName: raw.videoRoomName,
      videoRoomUrl: raw.videoRoomUrl ?? null,
      participantName: "",
      windowOpensAt,
      windowClosesAt: raw.callStartedAt + JOIN_WINDOW_AFTER_MS,
      recordingConsent: raw.recordingConsent ?? null,
    };
  }

  const windowClosesAt = raw.scheduledAt + JOIN_WINDOW_AFTER_MS;
  const status: "joinable" | "scheduled" =
    now >= windowOpensAt && now <= windowClosesAt ? "joinable" : "scheduled";

  return {
    sessionId: raw._id,
    scheduledAt: raw.scheduledAt,
    status,
    startedAt: null,
    videoRoomName: null,
    videoRoomUrl: null,
    participantName: "",
    windowOpensAt,
    windowClosesAt,
    recordingConsent: raw.recordingConsent ?? null,
  };
}

type VideoCallProviderProps = {
  workspaceId: Id<"workspaces"> | null;
  children: React.ReactNode;
  /**
   * PR #4c-2: optional session id to auto-join on mount. Set by the
   * `/workspace/[id]?join={sessionId}` deep-link route. The provider
   * effect below fires `markCallStarted` (if needed) and `call.join()`
   * once the session becomes `active` — skipping the consent modal
   * and the manual "Join" click.
   *
   * If the session is already ended by the time the user lands, the
   * effect short-circuits silently and the workspace renders as a
   * normal workspace (no error toast, no broken UI).
   */
  initialJoinSessionId?: Id<"sessions">;
};

/**
 * Owns the Daily call object + state, exposes it via React Context.
 *
 * Architecture note: `useVideoCall` internally calls `useDaily()`
 * (from `@daily-co/daily-react`) to obtain the call object. That hook
 * reads the DailyProvider context, which is NOT visible from a
 * component that renders `<DailyProvider>` as a child of itself —
 * React's context lookup only sees ancestors, not self-rendered
 * descendants. We therefore split into:
 *   1. `<VideoCallProvider>` — outer shell, just renders DailyProvider
 *      and forwards children.
 *   2. `<VideoCallProviderInner>` — child of DailyProvider, contains
 *      all the call logic that uses `useVideoCall` / `useDaily()`.
 *
 * Wires together:
 *   - `useCurrentOrUpcomingSessionForWorkspace` — Convex query for the
 *     current/next session on the workspace.
 *   - `useVideoCall` — Daily call lifecycle (join/leave/device toggles).
 *   - `useKeyboardShortcuts` — global `m`/`v`/`s`/`p`/`Esc` bindings
 *     active while a call is joined.
 *   - `markCallStarted` — fires when the Join Call button is pressed,
 *     so the call has a `callStartedAt` timestamp before the Daily
 *     room is fetched.
 *
 * PiP state is local to the provider (no persistence — PiP is a
 * transient UI mode, not a user preference).
 */
export function VideoCallProvider({
  workspaceId,
  children,
  initialJoinSessionId,
}: VideoCallProviderProps) {
  // NOTE: this component MUST stay free of hooks that read DailyProvider
  // context (e.g. useDaily, useVideoCall). All call logic lives in
  // VideoCallProviderInner, which is a child of <DailyProvider>.
  return (
    <DailyProvider>
      <VideoCallProviderInner
        workspaceId={workspaceId}
        initialJoinSessionId={initialJoinSessionId}
      >
        {children}
      </VideoCallProviderInner>
    </DailyProvider>
  );
}

/**
 * Inner component that runs call logic. Mounted as a child of
 * `<DailyProvider>` so `useDaily()` returns the actual DailyCall
 * instance instead of the default `null`.
 */
function VideoCallProviderInner({
  workspaceId,
  children,
  initialJoinSessionId,
}: VideoCallProviderProps) {
  const sessionQuery = useCurrentOrUpcomingSessionForWorkspace(workspaceId);

  // PR #4c-2: when the user lands on `/workspace/[id]?join={sessionId}`,
  // `getCurrentOrUpcomingSessionForWorkspace` may return a DIFFERENT
  // session — e.g. a freshly-scheduled one that wins the index scan
  // (it sorts by `callStartedAt desc`, but if neither has started
  // yet, the priority logic can still pick a different scheduled
  // session than the deep-link target). Querying the deep-link
  // session directly ensures the auto-join path uses ITS status,
  // not the workspace's "current" winner. Convex returns `null`
  // when the session has been deleted/ended.
  const deepLinkSessionQuery = useQuery(
    convexQuery(
      api.sessions.getSessionById,
      initialJoinSessionId ? { id: initialJoinSessionId } : "skip"
    )
  );
  const deepLinkRawSession = deepLinkSessionQuery.data ?? null;

  // Merge logic: when the deep-link session matches the
  // `initialJoinSessionId` AND the workspace's current session
  // does NOT match, use the deep-link session for video-call
  // wiring. Otherwise fall back to the workspace's current
  // session so non-deep-link loads keep the existing behavior.
  const deepLinkEffectiveSession: typeof sessionQuery.data = useMemo(() => {
    if (
      !initialJoinSessionId ||
      !deepLinkRawSession ||
      deepLinkSessionQuery.isLoading
    ) {
      return null;
    }
    if (String(deepLinkRawSession._id) !== String(initialJoinSessionId)) {
      return null;
    }
    return deriveCurrentOrUpcomingSession(deepLinkRawSession);
  }, [initialJoinSessionId, deepLinkRawSession, deepLinkSessionQuery.isLoading]);

  const session = useMemo(() => {
    if (deepLinkEffectiveSession) return deepLinkEffectiveSession;
    return sessionQuery.data ?? null;
  }, [deepLinkEffectiveSession, sessionQuery.data]);

  const [isPictureInPicture, setIsPictureInPicture] = useState(false);
  const queryClient = useQueryClient();
  const markCallStarted = useMutation({
    mutationFn: useConvexMutation(api.sessions.markCallStarted),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const call = useVideoCall({
    enabled:
      session?.status === "active" || session?.status === "joinable",
    workspaceId,
    sessionId: session?.sessionId ?? null,
    roomName: session?.videoRoomName ?? null,
  });

  const joinCall = useCallback(async (): Promise<void> => {
    if (!session) return;
    if (session.status === "active") {
      await call.join();
      return;
    }
    if (session.status === "joinable") {
      try {
        await markCallStarted.mutateAsync({ sessionId: session.sessionId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await reportError({
          source: "videoCallProvider.join.markCallStarted",
          error: err instanceof Error ? err : new Error(message),
          level: "error",
          message: "Failed to mark call started",
          context: { sessionId: session.sessionId },
        });
        throw new Error(`Failed to start call: ${message}`);
      }
      // sessionQuery refetches → session.status becomes "active" → call.join runs via effect.
    }
  }, [call, markCallStarted, session]);

  const togglePictureInPicture = useCallback((): void => {
    setIsPictureInPicture((prev) => !prev);
  }, []);

  const handlers = useMemo(
    () => ({
      onToggleMute: call.toggleMute,
      onToggleCamera: call.toggleCamera,
      onToggleScreenShare: call.toggleScreenShare,
      onTogglePip: togglePictureInPicture,
      onLeaveCall: () => {
        void call.leave();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- call is captured fresh each render; the per-call handlers below are stable within a render
    [call.toggleMute, call.toggleCamera, call.toggleScreenShare, call.leave, togglePictureInPicture]
  );

  useKeyboardShortcuts(call.status === "joined", handlers);

  // If the session moves to "active" (either via join or by another
  // participant already having started), auto-join once. The PR #2
  // session API guarantees a `videoRoomName` for `status: "active"`.
  // Errors here are silent — the manual Join button surfaces them
  // via toast in CallStatusPill.
  useEffect(() => {
    if (!session) return;
    if (session.status !== "active") return;
    if (call.status !== "idle") return;
    if (!session.videoRoomName) return;
    void call.join().catch(() => {
      // Error already captured by useVideoCall state (errorMessage).
      // No toast here — this path runs on initial mount and any
      // double-fire would spam the user.
    });
    // We intentionally depend on the primitive `call.status` and the
    // stable `call.join` reference rather than the whole `call` object.
    // `call` is memoized but its identity still shifts when device
    // toggles fire; including it would cause spurious re-runs of
    // this auto-join effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.join, call.status, session]);

  // PR #4c-2: deep-link auto-join. When the user lands on
  // `/workspace/[id]?join={sessionId}`, the page passes
  // `initialJoinSessionId` down. The merged `session` variable above
  // already reflects the deep-link target (it prefers the deep-link
  // effective session over the workspace's "current" session), so
  // the existing join effect above will fire `call.join()` once the
  // session becomes "active". This effect only handles the
  // pre-join transition: if status is "joinable", call
  // `markCallStarted` so the session transitions to "active" and
  // the join effect above picks it up next render.
  //
  // Effect intentionally does not depend on `call.join` because
  // `call.join` can shift identity on device toggles and cause a
  // duplicate trigger.
  useEffect(() => {
    if (!initialJoinSessionId) return;
    if (!session) return;
    if (String(session.sessionId) !== String(initialJoinSessionId)) return;

    if (session.status === "joinable") {
      void markCallStarted
        .mutateAsync({ sessionId: session.sessionId })
        .catch(async (err) => {
          // Telemetry: deep-link auto-join failures are otherwise
          // invisible — the user lands in the workspace and sees a
          // call that isn't joining. We capture the failure here so
          // the dashboard has a signal to investigate; CallStatusPill
          // surfaces the same failure to the user via toast.
          await reportError({
            source: "videoCallProvider.deepLink.markCallStarted",
            error: err instanceof Error ? err : new Error(String(err)),
            level: "warn",
            message: "Deep-link auto-join markCallStarted failed",
            context: {
              sessionId: String(session.sessionId),
              workspaceId: workspaceId ? String(workspaceId) : null,
            },
          });
        });
    }
    // `active` path is handled by the join effect above. We only
    // need to fire `markCallStarted` here when the deep-link session
    // is in the pre-join "joinable" state.
  }, [session, initialJoinSessionId, markCallStarted, workspaceId]);

  const value: VideoCallContextValue = useMemo(
    () => ({
      workspaceId,
      session,
      status: call.status,
      isMuted: call.isMuted,
      isCameraOff: call.isCameraOff,
      isScreenSharing: call.isScreenSharing,
      isPictureInPicture,
      participantCount: call.participantCount,
      remoteParticipantName: call.remoteParticipantName,
      errorMessage: call.errorMessage,
      durationSeconds: call.durationSeconds,
      join: joinCall,
      leave: call.leave,
      toggleMute: call.toggleMute,
      toggleCamera: call.toggleCamera,
      toggleScreenShare: call.toggleScreenShare,
      togglePictureInPicture,
    }),
    [
      workspaceId,
      session,
      call.status,
      call.isMuted,
      call.isCameraOff,
      call.isScreenSharing,
      call.participantCount,
      call.remoteParticipantName,
      call.errorMessage,
      call.durationSeconds,
      call.toggleMute,
      call.toggleCamera,
      call.toggleScreenShare,
      call.leave,
      joinCall,
      togglePictureInPicture,
      isPictureInPicture,
    ]
  );

  return (
    <VideoCallContext.Provider value={value}>{children}</VideoCallContext.Provider>
  );
}
