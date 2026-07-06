"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useDaily,
  useDailyEvent,
  useLocalSessionId,
  useMeetingState,
  useParticipantIds,
  useScreenShare,
} from "@daily-co/daily-react";
import type { DailyEventObject } from "@daily-co/daily-js";

import { useMutation } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { reportError } from "@/lib/observability";

type CallStatus =
  | "idle"
  | "joining"
  | "joined"
  | "leaving"
  | "error"
  | "ended";

/**
 * Fetches a Daily meeting token from `GET /api/video/token/[roomName]`
 * and joins the Daily room. Manages the full call lifecycle for PR #3.
 *
 * The token route reads the caller's Clerk identity, resolves the
 * session via `api.sessions.getSessionByVideoRoomName` (PR #2), and
 * issues an `owner` (instructor) or `participant` (student) JWT.
 * The token's `user_name` claim is honored as the Daily display name
 * (set server-side from Clerk sessionClaims) — we deliberately do not
 * pass `userName` to `daily.join()` so the server-resolved name wins.
 *
 * Calls `api.sessions.endCall` on leave so `callEndedAt` is set,
 * closing the join window via `getSessionByVideoRoomName` returning
 * null on any subsequent token request.
 *
 * Tracks the in-call duration via a 1-second interval started after
 * `joined-meeting`. Used by the VideoPanel to render the call timer.
 *
 * Status transitions: idle → joining → joined → leaving → ended.
 */
export function useVideoCall(input: {
  enabled: boolean;
  workspaceId: Id<"workspaces">;
  sessionId: Id<"sessions">;
  roomName: string;
}) {
  const daily = useDaily();
  const meetingState = useMeetingState();
  const localSessionId = useLocalSessionId();
  const participantIds = useParticipantIds();
  const screenShare = useScreenShare();
  const endCall = useMutation({
    mutationFn: useConvexMutation(api.sessions.endCall),
  });

  const [status, setStatus] = useState<CallStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [joinedAtMs, setJoinedAtMs] = useState<number | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [remoteParticipantName, setRemoteParticipantName] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [isCameraOff, setIsCameraOff] = useState(true);
  const joinInFlight = useRef(false);
  const leaveInFlight = useRef(false);

  // ── join ──────────────────────────────────────────────────────────────────
  const join = useCallback(async () => {
    if (joinInFlight.current) return;
    if (!input.enabled) return;
    if (!daily) {
      setErrorMessage("Video call provider not ready");
      setStatus("error");
      return;
    }
    joinInFlight.current = true;
    setStatus("joining");
    setErrorMessage(null);

    try {
      const tokenRes = await fetch(`/api/video/token/${encodeURIComponent(input.roomName)}`);
      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        throw new Error(`Token request failed (${tokenRes.status}): ${body.slice(0, 200)}`);
      }
      const json = (await tokenRes.json()) as { token?: string };
      if (!json.token) throw new Error("Token response missing 'token' field");

      const roomUrl = `https://${process.env.NEXT_PUBLIC_DAILY_DOMAIN ?? "huckleberryartinc.daily.co"}/${input.roomName}`;

      await daily.join({
        url: roomUrl,
        token: json.token,
      });

      setJoinedAtMs(Date.now());
      setStatus("joined");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      setStatus("error");
      await reportError({
        source: "useVideoCall.join",
        error: err instanceof Error ? err : new Error(message),
        level: "error",
        message: "Failed to join video call",
        context: { sessionId: input.sessionId, roomName: input.roomName },
      });
      // Re-throw so manual Join button callers can surface a toast.
      // The auto-join effect catches and ignores.
      throw err;
    } finally {
      joinInFlight.current = false;
    }
  }, [daily, input.enabled, input.roomName, input.sessionId]);

  // ── leave ─────────────────────────────────────────────────────────────────
  const leave = useCallback(async () => {
    if (leaveInFlight.current) return;
    leaveInFlight.current = true;
    setStatus("leaving");
    try {
      if (daily && meetingState === "joined-meeting") {
        await daily.leave();
      }
    } catch (err) {
      await reportError({
        source: "useVideoCall.leave",
        error: err,
        level: "warn",
        message: "Daily leave() threw; continuing to mark call ended",
      });
    }

    try {
      await endCall.mutateAsync({ sessionId: input.sessionId });
    } catch (err) {
      await reportError({
        source: "useVideoCall.leave.endCall",
        error: err,
        level: "warn",
        message: "Failed to mark call ended in Convex (call may be auto-ended via webhook)",
      });
    }

    setStatus("ended");
    setJoinedAtMs(null);
    setDurationSeconds(0);
    leaveInFlight.current = false;
    // input.sessionId is captured in mutateAsync — included for completeness
  }, [daily, endCall, input.sessionId, meetingState]);

  // ── duration ticker ───────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== "joined" || joinedAtMs === null) {
      setDurationSeconds(0);
      return;
    }
    const tick = () => setDurationSeconds(Math.floor((Date.now() - joinedAtMs) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [status, joinedAtMs]);

  // ── device toggles ────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    if (!daily) return;
    try {
      const next = !daily.localAudio();
      daily.setLocalAudio(next);
      setIsMuted(!next);
    } catch (err) {
      void reportError({ source: "useVideoCall.toggleMute", error: err, level: "warn" });
    }
  }, [daily]);

  const toggleCamera = useCallback(() => {
    if (!daily) return;
    try {
      const next = !daily.localVideo();
      daily.setLocalVideo(next);
      setIsCameraOff(!next);
    } catch (err) {
      void reportError({ source: "useVideoCall.toggleCamera", error: err, level: "warn" });
    }
  }, [daily]);

  const toggleScreenShare = useCallback(() => {
    try {
      if (screenShare.isSharingScreen) {
        screenShare.stopScreenShare();
      } else {
        screenShare.startScreenShare();
      }
    } catch (err) {
      void reportError({ source: "useVideoCall.toggleScreenShare", error: err, level: "warn" });
    }
  }, [screenShare]);

  // ── meeting-state autosync ────────────────────────────────────────────────
  useDailyEvent(
    "joined-meeting",
    useCallback(() => {
      setStatus("joined");
      if (joinedAtMs === null) setJoinedAtMs(Date.now());
      // Read device state from the call object so the controls reflect reality
      if (daily) {
        setIsMuted(!daily.localAudio());
        setIsCameraOff(!daily.localVideo());
      }
    }, [daily, joinedAtMs])
  );

  useDailyEvent(
    "left-meeting",
    useCallback(() => {
      setStatus("ended");
      setJoinedAtMs(null);
    }, [])
  );

  useDailyEvent(
    "error",
    useCallback(
      (event: DailyEventObject<"error">) => {
        const message = event?.error?.message ?? "Daily call error";
        setErrorMessage(message);
        setStatus("error");
        void reportError({
          source: "useVideoCall.daily.error",
          error: new Error(message),
          level: "error",
          message: "Daily call error event",
          context: { sessionId: input.sessionId },
        });
      },
      [input.sessionId]
    )
  );

  // ── remote participant name ───────────────────────────────────────────────
  useDailyEvent(
    "participant-joined",
    useCallback(
      (event: DailyEventObject<"participant-joined">) => {
        const participant = event?.participant;
        if (!participant) return;
        if (participant.session_id === localSessionId) return;
        if (participant.user_name) setRemoteParticipantName(participant.user_name);
      },
      [localSessionId]
    )
  );

  useDailyEvent(
    "participant-left",
    useCallback(
      (event: DailyEventObject<"participant-left">) => {
        const participant = event?.participant;
        if (!participant) return;
        setRemoteParticipantName((prev) =>
          prev && participant.user_name === prev ? null : prev
        );
      },
      []
    )
  );

  // Cleanup on unmount: leave the Daily room AND mark callEndedAt in
  // Convex so the session isn't stuck in "active" state. Without the
  // endCall mutation, the next participant opening the workspace would
  // see an "active" call and auto-join a Daily room that no one is in.
  // The recording webhook (PR #1) is the backstop for cases where the
  // browser crashes before this cleanup runs, but we shouldn't depend
  // on it for the common case.
  useEffect(() => {
    return () => {
      const wasJoined = daily && daily.meetingState() === "joined-meeting";
      if (wasJoined) {
        void daily.leave();
      }
      // Only invoke endCall if the call actually started — avoid
      // touching sessions that were never joined.
      if (wasJoined) {
        void endCall
          .mutateAsync({ sessionId: input.sessionId })
          .catch((err: unknown) => {
            void reportError({
              source: "useVideoCall.unmount.endCall",
              error: err,
              level: "warn",
              message: "endCall failed during unmount cleanup",
            });
          });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    isMuted,
    isCameraOff,
    isScreenSharing: screenShare.isSharingScreen,
    participantCount: participantIds.length,
    remoteParticipantName,
    errorMessage,
    durationSeconds,
    join,
    leave,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
  };
}
