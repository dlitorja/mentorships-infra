"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DailyProvider } from "@daily-co/daily-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { reportError } from "@/lib/observability";

import { VideoCallContext, type VideoCallContextValue } from "@/lib/video/video-context";
import { useCurrentOrUpcomingSessionForWorkspace } from "@/lib/hooks/use-active-session";
import { useVideoCall } from "@/lib/hooks/use-video-call";
import { useKeyboardShortcuts } from "@/lib/hooks/use-keyboard-shortcuts";

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
  const session = sessionQuery.data ?? null;

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
  // `initialJoinSessionId` down. We compare it to the session the
  // workspace query found. Three outcomes:
  //   1. The session matches AND status is "active" → `call.join()`
  //      fires via the effect above (no extra work needed).
  //   2. The session matches AND status is "joinable" → call
  //      `markCallStarted` so it transitions to "active" and the
  //      join effect above fires next render.
  //   3. No matching session (ended/cancelled/expired) → no-op.
  //      The workspace renders normally; the user sees a
  //      non-call workspace. `CallStatusPill` shows the
  //      appropriate "no call" state.
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
        .catch(() => {
          // Error path: the workspace query will refetch and surface
          // the failure state in CallStatusPill. Silently swallow
          // here so we don't double-toast.
        });
    }
    // `joinable` and `active` paths handled by the effect above
    // and the markCallStarted mutation that follows.
  }, [session, initialJoinSessionId, markCallStarted]);

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
