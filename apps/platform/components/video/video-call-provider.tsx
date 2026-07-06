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
};

/**
 * Owns the Daily call object + state, exposes it via React Context.
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
export function VideoCallProvider({ workspaceId, children }: VideoCallProviderProps) {
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
    enabled: session?.status === "active" || session?.status === "joinable",
    workspaceId: workspaceId ?? ("_placeholder" as Id<"workspaces">),
    sessionId: session?.sessionId ?? ("_placeholder" as Id<"sessions">),
    roomName: session?.videoRoomName ?? "",
  });

  const joinCall = useCallback(async () => {
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

  const togglePictureInPicture = useCallback(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- call is captured fresh on each render; the per-call handlers below are stable within a render
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
  }, [call, session]);

  const value: VideoCallContextValue = {
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
  };

  return (
    <DailyProvider>
      <VideoCallContext.Provider value={value}>{children}</VideoCallContext.Provider>
    </DailyProvider>
  );
}
