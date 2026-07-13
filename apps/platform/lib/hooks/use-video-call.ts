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

  // Capture the stable `mutateAsync` reference in a ref so the
  // unmount cleanup doesn't need `endCall` (the whole mutation
  // object) in its dependency array. Otherwise the cleanup would
  // re-register whenever mutation-state flips (pending → success),
  // and a stale cleanup could call `endCall` against an already-
  // ended session.
  const endCallMutateRef = useRef(endCall.mutateAsync);
  useEffect(() => {
    endCallMutateRef.current = endCall.mutateAsync;
  }, [endCall.mutateAsync]);

  // Track the latest remote participant's `session_id` (not name)
  // so we can clear `remoteParticipantName` correctly on leave —
  // independent of `setUserName` mid-call.
  const remoteSessionIdRef = useRef<string | null>(null);

  const [status, setStatus] = useState<VideoCallStatus>("idle");
  // Synchronous mirror of `status` so `join()` can re-entrancy-guard
  // itself before the first `setStatus("joining")` has committed.
  // Without this, two rapid callers (auto-join effect re-fire, button
  // double-click) can both pass the `call.status !== "idle"` check at
  // the provider level and issue duplicate `GET /api/video/token/...`
  // fetches — each 403s after `endCall` because
  // `getSessionByVideoRoomName` returns null for sessions whose
  // `callEndedAt` is set. The ref updates synchronously inside `join`
  // so the second caller bails before issuing the duplicate request.
  const statusRef = useRef<VideoCallStatus>("idle");
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
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
    // Re-entrancy guard: bail if a join/leave round is in flight or
    // the call is already joined. Two rapid callers (auto-join
    // effect re-fire, button double-click) can both pass the
    // provider-level `call.status !== "idle"` check before this
    // hook's `setStatus("joining")` has committed, causing duplicate
    // token fetches. `statusRef.current` updates synchronously below
    // so the second caller sees `"joining"` / `"joined"` / `"leaving"`
    // and bails. `"idle"` and `"error"` both allow entry — the
    // latter so the Retry button works after a failed join.
    if (
      statusRef.current === "joining" ||
      statusRef.current === "joined" ||
      statusRef.current === "leaving"
    ) {
      return;
    }
    statusRef.current = "joining";
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
      // Reset `statusRef.current` synchronously alongside
      // `setStatus("error")` so a rapid Retry click (or any caller
      // that invokes `join()` before the React commit lands) is not
      // silently blocked by the re-entrancy guard above. The
      // mirror `useEffect` will eventually overwrite this with the
      // committed `"error"`, so the manual write is purely a
      // synchronous fallback for the in-between window.
      statusRef.current = "error";
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
      // Mirror `join()`'s synchronous statusRef pattern so a rapid
      // `join()` after this short-circuit isn't blocked by a stale
      // ref value. But don't clobber a `"joining"` or `"leaving"`
      // statusRef value — an in-flight join/leave is managing its
      // own status transitions, and resetting would reopen the
      // re-entrancy guard at the top of `join()`, allowing a
      // duplicate `GET /api/video/token/...` fetch to race the
      // first one.
      if (statusRef.current !== "joining" && statusRef.current !== "leaving") {
        // Don't reset to "idle" — that's what triggers the auto-join
        // effect in <VideoCallProvider> to immediately retry the
        // failed join, looping `GET /api/video/token/...` until the
        // server-side guard (callEndedAt set, or instructor userId
        // mismatch) 403s again. Instead, keep the current status so
        // the auto-join effect's `call.status !== "idle"` guard
        // blocks the retry. The `join()` re-entrancy guard already
        // accepts `"error"` so the Retry button still works.
        //
        // When the user clicked Leave specifically because they
        // want OUT (not Retry), also fire `endCall` so the session
        // is marked ended server-side — the `["sessions"]` query
        // refetch makes `session` null, the auto-join effect short-
        // circuits on `!session`, and the overlay unmounts via
        // `useIsCallOverlayVisible`. Without this, the user is
        // stuck on the error UI with no way back to the workspace.
        if (statusRef.current === "error" && sessionId) {
          endCall.mutate({ sessionId }).catch(() => {});
        }
      }
      return;
    }
    statusRef.current = "leaving";
    setStatus("leaving");
    try {
      await daily.leave();
      if (joinedSessionId) {
        await endCall.mutateAsync({ sessionId: joinedSessionId });
      }
      didJoinRef.current = false;
      setJoinedSessionId(null);
      // Synchronously flip statusRef so a rapid rejoin after End Call
      // (e.g., user immediately clicks Join again) doesn't see a
      // stale `"leaving"` value before the `useEffect` mirror fires.
      statusRef.current = "idle";
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
      statusRef.current = "error";
      setStatus("error");
      setErrorMessage(message);
    }
  }, [daily, endCall, joinedSessionId, meetingState, sessionId, workspaceId]);

  // Cleanup on unmount: leave + endCall if we joined. Captured
  // refs for `mutateAsync` and `invalidateQueries` so the cleanup
  // doesn't re-register when mutation state flips mid-call.
  const invalidateSessionsRef = useRef(() => {
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
  });
  useEffect(() => {
    invalidateSessionsRef.current = () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    };
  }, [queryClient]);

  // Cleanup on unmount: leave + endCall if we joined. We depend on
  // `daily` only — `endCall` and `queryClient` are accessed via
  // refs so the cleanup only re-registers when the Daily call
  // instance changes (rare in practice).
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
          endCallMutateRef
            .current({ sessionId: sid })
            .then(() => {
              invalidateSessionsRef.current();
            })
            .catch(() => {
              /* swallow — unmount path */
            });
        }
      }
    };
  }, [daily]);

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

  // Track participant count + remote name. Key identity by
  // `session_id` (not `user_name`) so a mid-call `setUserName` does
  // not corrupt our tracking. The remote session id is mirrored to a
  // ref so the participant-left handler can compare against the
  // latest value.
  useDailyEvent(
    "participant-joined",
    useCallback(
      (evt: {
        participant: {
          session_id?: string;
          user_name?: string;
          local?: boolean;
        };
      }) => {
        setParticipantCount((prev) => Math.max(prev + 1, 1));
        if (!evt.participant.local && evt.participant.session_id) {
          remoteSessionIdRef.current = evt.participant.session_id;
          if (evt.participant.user_name) {
            setRemoteParticipantName(evt.participant.user_name);
          }
        }
      },
      []
    )
  );

  useDailyEvent(
    "participant-left",
    useCallback(
      (evt: {
        participant: { session_id?: string; user_name?: string };
      }) => {
        setParticipantCount((prev) => Math.max(prev - 1, 0));
        // Only clear the remote name if the leaving participant's
        // session_id matches the one we recorded — name changes via
        // setUserName won't match.
        if (
          evt.participant.session_id &&
          evt.participant.session_id === remoteSessionIdRef.current
        ) {
          remoteSessionIdRef.current = null;
          setRemoteParticipantName(null);
        }
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
