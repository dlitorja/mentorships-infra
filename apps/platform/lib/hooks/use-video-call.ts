"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useDaily,
  useDailyEvent,
  useMeetingState,
  useScreenShare,
} from "@daily-co/daily-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DEFAULT_DAILY_DOMAIN } from "@/lib/daily";
import { reportError } from "@/lib/observability";

export type VideoCallStatus =
  | "idle"
  | "joining"
  | "joined"
  | "leaving"
  | "error";

export type UseVideoCallOptions = {
  /**
   * Whether the call hook should be live. When false, the hook does not
   * attempt to join, exposes `status: "idle"`, and skips all effects.
   */
  enabled: boolean;
  workspaceId: Id<"workspaces"> | null;
  sessionId: Id<"sessions"> | null;
  roomName: string | null;
};

export type UseVideoCallResult = {
  status: VideoCallStatus;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  participantCount: number;
  remoteParticipantName: string | null;
  errorMessage: string | null;
  durationSeconds: number;
  join: () => Promise<void>;
  leave: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => void;
};

/**
 * Shape of `GET /api/video/token/[roomName]`. Validated with zod
 * instead of casting through `as` so misconfigurations surface as a
 * clear parse error rather than a runtime null access.
 */
const tokenResponseSchema = z.object({
  token: z.string().min(1),
});

/**
 * Hook that owns the Daily call lifecycle for a single workspace +
 * session. Returns immutable state + stable action handlers. Designed
 * to be called inside a `<DailyProvider>` (so `useDaily()` returns the
 * actual call object).
 *
 * Effects:
 *   1. When `enabled` + `roomName` flip from null → non-null, fetch a
 *      meeting token from `GET /api/video/token/[roomName]` and call
 *      `daily.join({ url, token })`.
 *   2. On unmount OR when the session is reset to null, call
 *      `daily.leave()` followed by `endCall` (only if we actually
 *      joined — never call `endCall` on a session we never entered).
 *   3. Track mute / camera / screenshare via Daily + local mirrors.
 *   4. Tick `durationSeconds` while in the meeting; reset on leave.
 *   5. Track the remote participant by `session_id` (not `user_name`,
 *      which can change mid-call via `setUserName`).
 *
 * The hook uses refs to track the latest `sessionId` and `workspaceId`
 * so the unmount cleanup uses the correct identifiers even if the
 * React state that spawned the effect has already closed over an
 * older value.
 */
export function useVideoCall(
  options: UseVideoCallOptions
): UseVideoCallResult {
  const { enabled, workspaceId, sessionId, roomName } = options;
  const daily = useDaily();
  const meetingState = useMeetingState();
  const { isSharingScreen, startScreenShare, stopScreenShare } =
    useScreenShare();

  const queryClient = useQueryClient();
  const endCall = useMutation({
    mutationFn: useConvexMutation(api.sessions.endCall),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const [status, setStatus] = useState<VideoCallStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [remoteParticipantName, setRemoteParticipantName] = useState<
    string | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [participantCount, setParticipantCount] = useState(0);
  const [joinedSessionId, setJoinedSessionId] = useState<Id<"sessions"> | null>(
    null
  );

  // Track the latest session/workspace for the unmount cleanup path,
  // which runs after React has cleared local state. Without refs, the
  // cleanup closure would capture the values from when the call
  // effect first fired, not the current values.
  const latestSessionIdRef = useRef<Id<"sessions"> | null>(null);
  const latestWorkspaceIdRef = useRef<Id<"workspaces"> | null>(null);
  const didJoinRef = useRef(false);

  useEffect(() => {
    latestSessionIdRef.current = sessionId;
    latestWorkspaceIdRef.current = workspaceId;
  }, [sessionId, workspaceId]);

  // Mirror Daily's local device state into React state so consumers
  // don't need access to the `daily` call object.
  useEffect(() => {
    if (!daily) return;
    setIsMuted(!daily.localAudio());
    setIsCameraOff(!daily.localVideo());
  }, [daily]);

  // Track meeting-state transitions into our higher-level `status`.
  useEffect(() => {
    if (meetingState === "joined-meeting") {
      setStatus("joined");
    } else if (meetingState === "joining-meeting") {
      setStatus("joining");
    } else if (meetingState === "left-meeting") {
      setStatus("idle");
    }
  }, [meetingState]);

  // Reset per-session state when the session changes (e.g. switching
  // workspaces or after a previous call ended).
  useEffect(() => {
    setRemoteParticipantName(null);
    setDurationSeconds(0);
    setParticipantCount(0);
    setErrorMessage(null);
  }, [sessionId]);

  // Duration ticker. Re-renders once per second while joined. The
  // interval is cleared on status change or unmount so it doesn't
  // leak.
  useEffect(() => {
    if (status !== "joined") return;
    const interval = window.setInterval(() => {
      setDurationSeconds((prev) => prev + 1);
    }, 1_000);
    return () => {
      window.clearInterval(interval);
    };
  }, [status]);

  const join = useCallback(async (): Promise<void> => {
    if (!enabled || !roomName || !sessionId) return;
    if (!daily) {
      setErrorMessage("Video provider not ready. Please retry in a moment.");
      setStatus("error");
      return;
    }
    setErrorMessage(null);
    setStatus("joining");
    try {
      const res = await fetch(`/api/video/token/${encodeURIComponent(roomName)}`);
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          `Failed to fetch meeting token (${res.status})${detail ? `: ${detail}` : ""}`
        );
      }
      const raw = await res.json();
      const parsed = tokenResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error("Invalid token response from server.");
      }
      const token = parsed.data.token;

      const domain = process.env.NEXT_PUBLIC_DAILY_DOMAIN ?? DEFAULT_DAILY_DOMAIN;
      const roomUrl = `https://${domain}/${roomName}`;
      await daily.join({ url: roomUrl, token });
      setJoinedSessionId(sessionId);
      didJoinRef.current = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      setStatus("error");
      await reportError({
        source: "useVideoCall.join",
        error: err instanceof Error ? err : new Error(message),
        level: "error",
        message: "Failed to join video call",
        context: { workspaceId, sessionId, roomName },
      });
      throw err;
    }
  }, [daily, enabled, roomName, sessionId, workspaceId]);

  const leave = useCallback(async (): Promise<void> => {
    if (!daily) return;
    if (meetingState !== "joined-meeting") {
      // We never successfully joined this session — don't burn the
      // `endCall` mutation by claiming we did.
      setStatus("idle");
      return;
    }
    setStatus("leaving");
    try {
      await daily.leave();
      if (joinedSessionId) {
        await endCall.mutateAsync({ sessionId: joinedSessionId });
      }
      didJoinRef.current = false;
      setJoinedSessionId(null);
      setStatus("idle");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await reportError({
        source: "useVideoCall.leave",
        error: err instanceof Error ? err : new Error(message),
        level: "error",
        message: "Failed to leave video call cleanly",
        context: { workspaceId, sessionId },
      });
      setStatus("error");
      setErrorMessage(message);
    }
  }, [daily, endCall, joinedSessionId, meetingState, sessionId, workspaceId]);

  // Cleanup on unmount: leave + endCall if we joined.
  useEffect(() => {
    return () => {
      const d = daily;
      if (!d) return;
      const ms = d.meetingState();
      if (ms === "joined-meeting") {
        const sid = latestSessionIdRef.current;
        d.leave().catch(() => {
          /* swallow — unmount path */
        });
        if (sid && didJoinRef.current) {
          // Fire and forget: endCall invalidates sessions query on success.
          endCall
            .mutateAsync({ sessionId: sid })
            .then(() => {
              queryClient.invalidateQueries({ queryKey: ["sessions"] });
            })
            .catch(() => {
              /* swallow — unmount path */
            });
        }
      }
    };
  }, [daily, endCall, queryClient]);

  const toggleMute = useCallback((): void => {
    const d = daily;
    if (!d) return;
    const next = !d.localAudio();
    d.setLocalAudio(next);
    setIsMuted(!next);
  }, [daily]);

  const toggleCamera = useCallback((): void => {
    const d = daily;
    if (!d) return;
    const next = !d.localVideo();
    d.setLocalVideo(next);
    setIsCameraOff(!next);
  }, [daily]);

  const toggleScreenShare = useCallback((): void => {
    if (isSharingScreen) {
      void stopScreenShare();
    } else {
      void startScreenShare();
    }
  }, [isSharingScreen, startScreenShare, stopScreenShare]);

  // Track participant count + remote name. Use `session_id` as the
  // identity key so name mutations (`daily.setUserName`) don't reset
  // the recorded remote name.
  useDailyEvent(
    "participant-joined",
    useCallback((evt: { participant: { session_id?: string; user_name?: string; local?: boolean } }) => {
      setParticipantCount((prev) => Math.max(prev + 1, 1));
      if (!evt.participant.local && evt.participant.user_name) {
        setRemoteParticipantName(evt.participant.user_name);
      }
    }, [])
  );

  useDailyEvent(
    "participant-left",
    useCallback(
      (evt: { participant: { session_id?: string; user_name?: string } }) => {
        setParticipantCount((prev) => Math.max(prev - 1, 0));
        setRemoteParticipantName((current) => {
          if (
            current &&
            evt.participant.user_name &&
            current === evt.participant.user_name
          ) {
            return null;
          }
          return current;
        });
      },
      []
    )
  );

  return useMemo<UseVideoCallResult>(
    () => ({
      status,
      isMuted,
      isCameraOff,
      isScreenSharing: isSharingScreen,
      participantCount,
      remoteParticipantName,
      errorMessage,
      durationSeconds,
      join,
      leave,
      toggleMute,
      toggleCamera,
      toggleScreenShare,
    }),
    [
      status,
      isMuted,
      isCameraOff,
      isSharingScreen,
      participantCount,
      remoteParticipantName,
      errorMessage,
      durationSeconds,
      join,
      leave,
      toggleMute,
      toggleCamera,
      toggleScreenShare,
    ]
  );
}
