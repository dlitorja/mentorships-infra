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
import { toast } from "sonner";
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DEFAULT_DAILY_DOMAIN } from "@/lib/daily";
import { reportError } from "@/lib/observability";
import { getVideoToken } from "@/lib/queries/api-client";
import {
  SCREEN_SHARE_DID_NOT_START_MESSAGE,
  SCREEN_SHARE_UNSUPPORTED_MESSAGE,
  isScreenShareSupported,
  isTouchPrimaryDevice,
} from "@/lib/video/screen-share-support";

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
  /**
   * PR #4c-4: flips to `true` synchronously when `leave()` is
   * invoked. The provider's auto-join effect uses this as a guard
   * so a programmatic leave does not race `endCall` into a
   * duplicate `GET /api/video/token/...` request that 403s once
   * `callEndedAt` is set server-side. Reset to `false` whenever
   * `sessionId` changes — a brand-new session is allowed to
   * auto-join again.
   */
  hasProgrammaticallyLeft: boolean;
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
 * How long `toggleScreenShare` waits for Daily to report an outcome
 * before telling the user the picker has not produced a share.
 *
 * `startScreenShare()` is non-blocking: it returns before the browser
 * picker appears, and on platforms without `getDisplayMedia` it is a
 * documented no-op that emits no event whatsoever. Without this
 * watchdog an unsupported device (an iPad on iPadOS 26 or earlier, any
 * Android tablet) sees a button that silently does nothing — the exact
 * bug reported for the instructor tablet flow.
 *
 * Only armed on touch-first devices. A desktop picker can stay open
 * while the user browses windows, and a timer firing then would be a
 * false alarm; touch devices are also where Daily is documented as
 * receive-only. 12s is long enough to pick a window, short enough that a
 * swallowed request still gets feedback.
 */
const SCREEN_SHARE_START_WATCHDOG_MS = 12_000;

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

  const [status, setStatus] = useState<VideoCallStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Watchdog for the fire-and-forget `startScreenShare()` call below.
  // Cleared by any Daily outcome event (started / stopped / canceled) or
  // by an error, so it only fires when the platform swallowed the
  // request without telling us anything.
  const screenShareWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const clearScreenShareWatchdog = useCallback((): void => {
    if (screenShareWatchdogRef.current !== null) {
      clearTimeout(screenShareWatchdogRef.current);
      screenShareWatchdogRef.current = null;
    }
  }, []);
  // A call left mid-request must not toast after the panel unmounts.
  useEffect(() => clearScreenShareWatchdog, [clearScreenShareWatchdog]);

  // Dedupe the "unsupported device" telemetry: one report per session is
  // enough to spot the pattern in Axiom, and repeated taps say nothing
  // new. Reset when the session changes.
  const unsupportedScreenShareReportedRef = useRef(false);
  useEffect(() => {
    unsupportedScreenShareReportedRef.current = false;
    // A pending share request belongs to the previous session. The hook
    // itself stays mounted across sessions, so unmount cleanup alone
    // would let a stale watchdog fire against the new one.
    clearScreenShareWatchdog();
  }, [clearScreenShareWatchdog, sessionId]);

  // The hook stays mounted after the call ends (`status` flips to
  // "leaving"/"idle"), so unmount is not the last word either. A share
  // that was swallowed must not toast after the user left the call.
  useEffect(() => {
    if (status !== "joined") clearScreenShareWatchdog();
  }, [clearScreenShareWatchdog, status]);

  const handleScreenShareError = useCallback(
    (ev: { errorMsg?: string | { message?: string } }) => {
      clearScreenShareWatchdog();
      const message =
        typeof ev.errorMsg === "string"
          ? ev.errorMsg
          : ev.errorMsg?.message ?? "Screen share failed";
      // Screen-share failures are nonfatal in daily-js: the call stays
      // joined. Surface the failure as a toast so the user gets feedback
      // without tearing down the active video call.
      toast.error("Screen share failed", { description: message });
      void reportError({
        source: "useVideoCall.toggleScreenShare",
        error: new Error(message),
        level: "error",
        message: "Screen share failed",
        context: { workspaceId, sessionId },
      });
    },
    [clearScreenShareWatchdog, sessionId, workspaceId]
  );

  const { isSharingScreen, startScreenShare, stopScreenShare } =
    useScreenShare({ onError: handleScreenShareError });

  // Mirror the active-share flag into a ref so the watchdog can check the
  // current value instead of the value captured when the button was
  // tapped (the start event may already have fired).
  const isSharingScreenRef = useRef(isSharingScreen);
  useEffect(() => {
    isSharingScreenRef.current = isSharingScreen;
  }, [isSharingScreen]);

  const queryClient = useQueryClient();
  const endCall = useMutation({
    mutationFn: useConvexMutation(api.sessions.endCall),
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === "convexQuery" &&
          typeof q.queryKey[1] === "string" &&
          q.queryKey[1].startsWith("sessions:"),
        refetchType: "all",
      });
    },
  });

  // PR platform-call-bugs: posts a system message to the workspace
  // chat when the LOCAL user joins or leaves the Daily room. Observer
  // events (`participant-joined` / `participant-left`) are NOT used
  // here because (a) Daily does not fire `participant-joined` for the
  // local user, so the first person's join would never be recorded,
  // and (b) when the last person leaves there is no observer client
  // left to record the departure. By writing from the joiner/leaver
  // themselves we cover both edges without risking duplicate
  // messages (each participant writes their own event exactly once).
  // Greptile round 3: the actor's display name is resolved server-
  // side from the caller's `users` row, NOT from a client-supplied
  // value, so a malicious participant cannot impersonate someone
  // else. Fire-and-forget: a transient Convex failure should not
  // interrupt the join / leave flow.
  //
  // Greptile round 7 P1+Security: the mutation now requires a
  // nonce minted by `prepareCallPresenceMessage`. Mint a fresh
  // nonce immediately before each record call so the server can
  // verify the caller actually performed the join / leave action.
  // The prepare mutation is itself authorized (workspace
  // participant + session-in-workspace), so a malicious caller
  // cannot mint nonces for arbitrary workspaces either. Failures
  // here are surfaced via `onError` so an operator can grep for
  // "presence-prepare" failures.
  const prepareCallPresenceMessage = useMutation({
    mutationFn: useConvexMutation(api.workspaces.prepareCallPresenceMessage),
    onError: (err) => {
      void reportError({
        source: "videoCall.prepareCallPresenceMessage",
        error: err instanceof Error ? err : new Error(String(err)),
        level: "warn",
        message: "Failed to prepare participant-joined/left nonce",
        context: { workspaceId, sessionId },
      });
    },
  });
  const recordCallPresenceMessage = useMutation({
    mutationFn: useConvexMutation(api.workspaces.recordCallPresenceMessage),
    // TanStack Query swallows errors from `mutate()` by default;
    // surface them via observability so the operator can grep for
    // "presence-message" failures. The participant count + chat
    // list stay correct either way.
    onError: (err) => {
      void reportError({
        source: "videoCall.recordCallPresenceMessage",
        error: err instanceof Error ? err : new Error(String(err)),
        level: "warn",
        message: "Failed to record participant-joined/left system message",
        context: { workspaceId, sessionId },
      });
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

  // Greptile round 4 P1: the cleanup `useEffect` (line ~581) must
  // NOT depend on `recordCallPresenceMessage` directly. When the
  // joiner's "joined" mutation result lands, the mutation object
  // reference changes, the effect re-runs, the cleanup tears
  // down the live call and posts a spurious "left" notice.
  // Mirror the existing `endCallMutateRef` pattern: capture the
  // mutate function in a ref so the cleanup only re-registers when
  // the Daily call instance changes.
  const recordCallPresenceMutateRef = useRef(recordCallPresenceMessage.mutate);
  useEffect(() => {
    recordCallPresenceMutateRef.current = recordCallPresenceMessage.mutate;
  }, [recordCallPresenceMessage.mutate]);

  // Greptile round 7 P1+Security: same ref-mirror pattern for the
  // new `prepareCallPresenceMessage` mutation. The cleanup path
  // uses this ref so it can mint a fresh nonce before recording a
  // "left" notice on unmount.
  const prepareCallPresenceMutateRef = useRef(prepareCallPresenceMessage.mutate);
  useEffect(() => {
    prepareCallPresenceMutateRef.current = prepareCallPresenceMessage.mutate;
  }, [prepareCallPresenceMessage.mutate]);

  // Track the latest remote participant's `session_id` (not name)
  // so we can clear `remoteParticipantName` correctly on leave —
  // independent of `setUserName` mid-call.
  const remoteSessionIdRef = useRef<string | null>(null);

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
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [participantCount, setParticipantCount] = useState(0);
  const [joinedSessionId, setJoinedSessionId] = useState<Id<"sessions"> | null>(
    null
  );
  // PR #4c-4: see `UseVideoCallResult.hasProgrammaticallyLeft`. Set
  // synchronously inside `leave()` and reset on `sessionId` change
  // so the provider's auto-join effect can gate on "did the user
  // intentionally leave THIS session". Used to break the race
  // where `meetingState === "left-meeting"` flips `status` to
  // `"idle"` while `endCall.mutateAsync` is still in flight — the
  // auto-join effect would otherwise re-fire `call.join()` and the
  // token fetch would 403 against a `callEndedAt` set by the
  // in-flight endCall.
  const [hasProgrammaticallyLeft, setHasProgrammaticallyLeft] = useState(false);
  useEffect(() => {
    setHasProgrammaticallyLeft(false);
  }, [sessionId]);

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
  // don't need access to the `daily` call object. `meetingState` is
  // included so we re-sync immediately after `join()` completes —
  // `daily` is the same object reference before and after
  // `daily.join()`, so without this dependency the effect would not
  // fire on join and `isMuted` could be stale.
  useEffect(() => {
    if (!daily) return;
    setIsMuted(!daily.localAudio());
    setIsCameraOff(!daily.localVideo());
  }, [daily, meetingState]);

  // Track meeting-state transitions into our higher-level `status`.
  //
  // PR #4c-4 follow-up: when `meetingState === "left-meeting"` fires
  // synchronously after `await daily.leave()` resolves, mapping to
  // `"idle"` here races `endCall.mutateAsync` (still in flight). Status
  // flips to `"idle"` while the session is still cached as `"active"`,
  // so the overlay stays visible AND `<VideoCall>` shows the
  // loading-state "Preparing call…" branch (it gates on
  // `status === "idle" || "joining" || "leaving"`). Suppress the
  // `left-meeting → idle` mapping when we've latched
  // `hasProgrammaticallyLeft` — `leave()` owns the terminal
  // `status: "idle"` transition once `endCall` completes. The mapping
  // still fires for network-drop-style "left-meeting" events that
  // arrive WITHOUT a programmatic leave (e.g., Daily lost the WebSocket
  // mid-call) because `hasProgrammaticallyLeft` stays false in that
  // path, surfacing the error UI via the existing `useVideoCall.join`
  // re-entrancy guard.
  //
  // PR platform-call-bugs round 7 P2: when the disconnect path
  // fires (network drop, Daily lost the WebSocket mid-call), the
  // chat is missing a "left" notice because the user did not
  // call `leave()` programmatically. Mint a fresh nonce and
  // post the "left" notice from this branch too so the chat
  // accurately reflects the user's departure. The mutation is
  // idempotent server-side (the nonce is consumed on use), so a
  // rapid leave + unmount double-fire cannot write two notices.
  useEffect(() => {
    if (meetingState === "joined-meeting") {
      setStatus("joined");
    } else if (meetingState === "joining-meeting") {
      setStatus("joining");
    } else if (meetingState === "left-meeting") {
      if (hasProgrammaticallyLeft) return;
      // Non-programmatic disconnect: surface a "left" notice via
      // the prepare + record chain so the chat reflects the user's
      // departure. The server-side nonce TTL (30s) and consumed
      // flag prevent duplicate writes if the unmount cleanup
      // also fires for the same session.
      if (workspaceId && sessionId && didJoinRef.current) {
        prepareCallPresenceMutateRef.current(
          { workspaceId, sessionId, kind: "left" },
          {
            onSuccess: (nonceId) => {
              recordCallPresenceMutateRef.current({
                workspaceId,
                sessionId,
                kind: "left",
                nonceId,
              });
            },
          }
        );
        didJoinRef.current = false;
      }
      setStatus("idle");
    }
  }, [meetingState, hasProgrammaticallyLeft, workspaceId, sessionId]);

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
    // Greptile round 6 P2: if the previous call dropped without a
    // programmatic leave (e.g., Daily disconnected, network blip),
    // `participantCount` and `remoteParticipantName` may still hold
    // stale values from that call. Reset BEFORE daily.join() so a
    // rejoin starts from a clean slate — the functional update
    // below adds +1 for the local user without inheriting the
    // dropped call's participant count. Remote observer events
    // fired during the pending period accumulate on top.
    setRemoteParticipantName(null);
    setParticipantCount(0);
    try {
      const raw = await getVideoToken(roomName);
      const parsed = tokenResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error("Invalid token response from server.");
      }
      const token = parsed.data.token;

      const domain = process.env.NEXT_PUBLIC_DAILY_DOMAIN ?? DEFAULT_DAILY_DOMAIN;
      const roomUrl = `https://${domain}/${roomName}`;
      // Camera off by default — users opt in via the webcam button.
      // `startVideoOff` tells Daily not to auto-start the camera on
      // this join, so there's no flash of video before we can call
      // setLocalVideo. Audio stays on so participants can join the
      // conversation hands-free without an extra click.
      await daily.join({ url: roomUrl, token, startVideoOff: true });
      setIsCameraOff(true);
      setJoinedSessionId(sessionId);
      didJoinRef.current = true;
      // PR platform-call-bugs: account for the local user in the
      // participant count. Daily does not fire `participant-joined`
      // for the local user, so without this the indicator chip
      // would stay at 0 until a remote joiner arrived. Use a
      // functional update so any remote joiners whose
      // `participant-joined` event already fired during the pending
      // period are preserved (Greptile round 5 P2): if a remote
      // joined while `daily.join()` was in flight, the observer
      // already incremented the count; we add +1 for the local
      // user without clobbering that increment.
      setParticipantCount((prev) => prev + 1);
      // PR platform-call-bugs round 2: post a self-authored "joined
      // the call" system message so workspace chat captures the
      // first join even when nobody is observing yet. Only the
      // joiner writes (not remote observers), so there's no risk
      // of duplicate entries when both A and B are present.
      //
      // Greptile round 3: the actor name is resolved server-side
      // from the caller's `users` row — we no longer pass a client-
      // supplied `systemActorName`. This prevents a malicious
      // participant from impersonating someone else in chat.
      //
      // Greptile round 7 P1+Security: mint a fresh nonce first
      // and pass its id to the record mutation. Without this the
      // server rejects the record call. We chain the two via the
      // prepare mutation's resolved id rather than awaiting the
      // record itself so a transient server failure on the
      // presence write does not roll back the just-successful
      // join. `onError` above surfaces failures to observability.
      if (workspaceId && sessionId) {
        prepareCallPresenceMessage.mutate(
          { workspaceId, sessionId, kind: "joined" },
          {
            onSuccess: (nonceId) => {
              recordCallPresenceMessage.mutate({
                workspaceId,
                sessionId,
                kind: "joined",
                nonceId,
              });
            },
          }
        );
      }
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
  }, [daily, enabled, prepareCallPresenceMessage, recordCallPresenceMessage, roomName, sessionId, workspaceId]);

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
        // is marked ended server-side — the `["convexQuery",
        // "sessions:..."]` query refetch (triggered by the
        // `endCall.onSuccess` predicate above) makes `session` null,
        // the auto-join effect short-circuits on `!session`, and the
        // overlay unmounts via `useIsCallOverlayVisible`. Without
        // this, the user is stuck on the error UI with no way back
        // to the workspace.
        if (statusRef.current === "error" && sessionId) {
          endCall.mutateAsync({ sessionId }).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            void reportError({
              source: "useVideoCall.leave.endCall",
              error: err instanceof Error ? err : new Error(message),
              level: "warn",
              message: "endCall from leave-from-error path failed; session may remain active server-side",
              context: { workspaceId, sessionId },
            });
          });
        }
      }
      return;
    }
    statusRef.current = "leaving";
    setStatus("leaving");
    // PR #4c-4: latch the auto-join guard BEFORE awaiting `daily.leave()`
    // so the provider's auto-join effect can't fire when
    // `meetingState === "left-meeting"` flips `status` to `"idle"`
    // before `endCall` completes. Without this, `call.status === "idle"`
    // AND a still-cached `"active"` session both become true and the
    // auto-join effect issues a duplicate `GET /api/video/token/...`
    // request that races `endCall` for the server — `endCall` wins
    // and sets `callEndedAt`, so the token endpoint returns null and
    // the request 403s.
    setHasProgrammaticallyLeft(true);
    // PR platform-call-bugs round 7 P2: clear `didJoinRef.current`
    // BEFORE awaiting `endCall.mutateAsync`. The unmount cleanup
    // path (line ~601) checks this ref before posting a "left"
    // notice — if it stayed true until after the await, a
    // component unmount racing the in-flight leave() could double-
    // post the notice. Setting it synchronously before the await
    // closes the race window.
    didJoinRef.current = false;
    try {
      await daily.leave();
      if (joinedSessionId) {
        await endCall.mutateAsync({ sessionId: joinedSessionId });
      }
      setJoinedSessionId(null);
      // PR platform-call-bugs round 2: post a self-authored "left
      // the call" system message so the last departure is recorded
      // (no observer client remains to fire `participant-left`).
      // Only the leaver writes; observers stay silent to avoid
      // duplicates when multiple clients observe the same leave.
      //
      // Greptile round 3: the actor name is resolved server-side
      // from the caller's `users` row — we no longer pass a client-
      // supplied `systemActorName`. This prevents a malicious
      // participant from impersonating someone else in chat.
      //
      // Greptile round 7 P1+Security: mint a fresh nonce first
      // and pass its id to the record mutation. Same chain as
      // the join path above; fire-and-forget so a transient
      // server failure does not interrupt the leave flow.
      if (workspaceId && sessionId) {
        prepareCallPresenceMessage.mutate(
          { workspaceId, sessionId, kind: "left" },
          {
            onSuccess: (nonceId) => {
              recordCallPresenceMessage.mutate({
                workspaceId,
                sessionId,
                kind: "left",
                nonceId,
              });
            },
          }
        );
      }
      // PR platform-call-bugs: reset `participantCount` on local
      // leave. Daily fires `participant-left` for the local
      // user too, but `Math.max(prev - 1, 0)` is a no-op when
      // we've already manually adjusted the count above (e.g.,
      // remote decrements brought it to 1). Resetting here
      // guarantees the indicator chip returns to its hidden
      // state when the local user leaves an otherwise-empty
      // room.
      setParticipantCount(0);
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
  }, [daily, endCall, joinedSessionId, meetingState, prepareCallPresenceMessage, recordCallPresenceMessage, sessionId, workspaceId]);

  // Cleanup on unmount: leave + endCall if we joined. Captured
  // refs for `mutateAsync` and `invalidateQueries` so the cleanup
  // doesn't re-register when mutation state flips mid-call.
  const invalidateSessionsRef = useRef(() => {
    queryClient.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === "convexQuery" &&
        typeof q.queryKey[1] === "string" &&
        q.queryKey[1].startsWith("sessions:"),
      refetchType: "all",
    });
  });
  useEffect(() => {
    invalidateSessionsRef.current = () => {
      queryClient.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === "convexQuery" &&
          typeof q.queryKey[1] === "string" &&
          q.queryKey[1].startsWith("sessions:"),
        refetchType: "all",
      });
    };
  }, [queryClient]);

  // Cleanup on unmount: leave + endCall if we joined. We depend on
  // `daily` only — `endCall` and `queryClient` are accessed via
  // refs so the cleanup only re-registers when the Daily call
  // instance changes (rare in practice).
  //
  // Greptile round 3 P1 (outside-diff): the unmount cleanup also
  // writes a self-authored "left the call" system message when the
  // user joined but the workspace is unmounting before they could
  // hit the End Call button (e.g. workspace switch, page
  // navigation, error-state auto-remount). Without this, the
  // remote observer's `participant-left` handler used to be the
  // only writer — and there may be no observer left in the room.
  // Fire-and-forget; the workspace/session/role checks inside
  // `recordCallPresenceMessage` will still run server-side, so a
  // stale workspaceId/sessionId just rejects the write without
  // crashing the unmount path.
  useEffect(() => {
    return () => {
      const d = daily;
      if (!d) return;
      const ms = d.meetingState();
      if (ms === "joined-meeting") {
        const sid = latestSessionIdRef.current;
        const wid = latestWorkspaceIdRef.current;
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
          // Self-authored departure so the chat captures the user
          // leaving even when there is no observer client in the
          // room to fire `participant-left`. Called via a ref to
          // avoid re-running this cleanup when the mutation's
          // internal state changes (Greptile round 4 P1).
          //
          // Greptile round 7 P1+Security: mint a fresh nonce
          // before recording. The cleanup path uses both
          // prepare + record refs so the unmount flow stays
          // self-contained.
          if (wid) {
            prepareCallPresenceMutateRef.current(
              { workspaceId: wid, sessionId: sid, kind: "left" },
              {
                onSuccess: (nonceId) => {
                  recordCallPresenceMutateRef.current({
                    workspaceId: wid,
                    sessionId: sid,
                    kind: "left",
                    nonceId,
                  });
                },
              }
            );
          }
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
    const reportScreenShareError = (source: string, err: unknown): void => {
      const message = err instanceof Error ? err.message : String(err);
      void reportError({
        source,
        error: err instanceof Error ? err : new Error(message),
        level: "error",
        message,
        context: { workspaceId, sessionId },
      });
    };
    if (isSharingScreen) {
      clearScreenShareWatchdog();
      (async () => {
        try {
          await stopScreenShare();
        } catch (err) {
          reportScreenShareError("useVideoCall.toggleScreenShare.stop", err);
        }
      })();
      return;
    }

    // Daily's `startScreenShare()` no-ops (and emits nothing) when the
    // browser has no `getDisplayMedia`. Explain the limitation instead of
    // leaving an instructor tapping a dead button.
    if (!isScreenShareSupported()) {
      toast.error("Screen sharing isn't available", {
        id: "screen-share-unsupported",
        description: SCREEN_SHARE_UNSUPPORTED_MESSAGE,
        // Longer than the default 4s: this is the only feedback an iPad
        // user gets, and it carries the workaround.
        duration: 10_000,
      });
      // Report once per call — a frustrated user may tap repeatedly and
      // each tap is the same environment fact.
      if (!unsupportedScreenShareReportedRef.current) {
        unsupportedScreenShareReportedRef.current = true;
        void reportError({
          source: "useVideoCall.toggleScreenShare.unsupported",
          error: new Error(
            "getDisplayMedia is not available in this browser"
          ),
          level: "warn",
          message: "Screen share requested on an unsupported device",
          context: {
            workspaceId,
            sessionId,
            userAgent:
              typeof navigator === "undefined"
                ? null
                : navigator.userAgent,
          },
        });
      }
      return;
    }

    // The API exists, but a touch device can still refuse silently (Daily
    // documents mobile browsers as receive-only even where
    // `getDisplayMedia` is exposed). Arm the watchdog there and let the
    // start / cancel / error handlers clear it.
    clearScreenShareWatchdog();
    if (isTouchPrimaryDevice()) {
      screenShareWatchdogRef.current = setTimeout(() => {
        screenShareWatchdogRef.current = null;
        if (isSharingScreenRef.current) return;
        toast.error("Screen sharing hasn't started", {
          id: "screen-share-did-not-start",
          description: SCREEN_SHARE_DID_NOT_START_MESSAGE,
          duration: 8_000,
        });
        void reportError({
          source: "useVideoCall.toggleScreenShare.timeout",
          error: new Error(
            "No screen-share event within the watchdog window"
          ),
          level: "warn",
          message: "Screen share did not start or cancel",
          context: { workspaceId, sessionId },
        });
      }, SCREEN_SHARE_START_WATCHDOG_MS);
    }

    (async () => {
      try {
        await startScreenShare();
      } catch (err) {
        clearScreenShareWatchdog();
        reportScreenShareError("useVideoCall.toggleScreenShare.start", err);
      }
    })();
  }, [
    clearScreenShareWatchdog,
    isSharingScreen,
    startScreenShare,
    stopScreenShare,
    sessionId,
    workspaceId,
  ]);

  // Any recorded outcome means the user got feedback from the platform:
  // stop the watchdog so it cannot toast over a successful share or a
  // deliberate picker cancellation.
  useDailyEvent(
    "local-screen-share-started",
    useCallback(() => {
      clearScreenShareWatchdog();
    }, [clearScreenShareWatchdog])
  );

  useDailyEvent(
    "local-screen-share-canceled",
    useCallback(() => {
      clearScreenShareWatchdog();
    }, [clearScreenShareWatchdog])
  );

  // Track participant count + remote name. Key identity by
  // `session_id` (not `user_name`) so a mid-call `setUserName` does
  // not corrupt our tracking. The remote session id is mirrored to a
  // ref so the participant-left handler can compare against the
  // latest value. Daily does NOT fire `participant-joined` for the
  // local user on join, so we initialize the count to 1 from
  // `join()`'s success path; remote joins / leaves increment and
  // decrement via these handlers.
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
        if (evt.participant.local) {
          // Local join is handled in `join()`'s success path; this
          // event is here for defensive counter bookkeeping if Daily
          // ever starts firing it. Skip to avoid double-counting.
          return;
        }
        setParticipantCount((prev) => prev + 1);
        if (evt.participant.session_id) {
          remoteSessionIdRef.current = evt.participant.session_id;
          if (evt.participant.user_name) {
            setRemoteParticipantName(evt.participant.user_name);
          }
        }
        // System-message writes live in `join()` / `leave()` so
        // each participant authors their own event exactly once.
        // Observers stay silent — otherwise two clients present
        // in the same call would each write the same join/leave
        // notice for every remote transition, doubling the chat
        // history. See the round-2 comment on
        // `recordCallPresenceMessage` above.
      },
      []
    )
  );

  useDailyEvent(
    "participant-left",
    useCallback(
      (evt: {
        participant: {
          session_id?: string;
          user_name?: string;
          local?: boolean;
        };
      }) => {
        if (evt.participant.local) {
          // Local leave is handled in `leave()`'s success path
          // (which resets `participantCount` to 0 and posts the
          // self-authored "left the call" system message). Skip
          // here to avoid double-decrement.
          return;
        }
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
        // System-message writes live in `join()` / `leave()` (see
        // the comment in the `participant-joined` handler above).
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
      hasProgrammaticallyLeft,
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
      hasProgrammaticallyLeft,
      join,
      leave,
      toggleMute,
      toggleCamera,
      toggleScreenShare,
    ]
  );
}
