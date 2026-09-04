"use client";

import { createContext, useContext } from "react";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Mirror of `convex/sessions.CurrentOrUpcomingSession` for client-side
 * consumption. Kept in sync manually because the Convex codegen only
 * re-exports function references through `api`, not types. Any change
 * to the Convex return shape MUST be mirrored here.
 */
export type CurrentOrUpcomingSession = {
  sessionId: Id<"sessions">;
  scheduledAt: number;
  status: "active" | "joinable" | "scheduled";
  startedAt: number | null;
  videoRoomName: string | null;
  videoRoomUrl: string | null;
  participantName: string;
  /**
   * Clerk user id of the student on this session. Mirrors
   * `convex/sessions.CurrentOrUpcomingSession.studentId`. Used by
   * the workspace UI to gate role-specific affordances (e.g. only
   * the student hides the Join Call button when no one has marked
   * the call as started yet).
   */
  studentId: string;
  windowOpensAt: number;
  windowClosesAt: number;
  /**
   * Last recorded consent value, or null if no consent has been captured
   * yet (e.g., an ad-hoc session whose creator hasn't confirmed). The
   * consent modal defaults to this when present and to `true` for
   * newly-booked sessions (the booking form sets `recordingConsent:
   * true`). Nullable so the UI can show "no choice yet" rather than
   * guessing.
   */
  recordingConsent: boolean | null;
};

/**
 * Status of the local Daily call. Mirrors `UseVideoCallResult.status`
 * in `lib/hooks/use-video-call.ts` — keep in sync.
 */
export type VideoCallStatus =
  | "idle"
  | "joining"
  | "joined"
  | "leaving"
  | "error";

/**
 * Snapshot of the call state shared via `VideoCallContext`.
 *
 * The provider owns the call state (Daily ref + UI flags) and exposes
 * it through React Context so child components (`VideoPanel`, PiP,
 * `CallStatusPill`) can subscribe without prop drilling. One ticker
 * drives durationSeconds — only the components that render it re-render.
 *
 * `isSessionLoading` is true ONLY while the workspace's current-or-
 * upcoming session query is in its first fetch. Consumers can use it
 * to distinguish "we don't know yet whether a call exists" (loading)
 * from "we know there is no call" (`session === null`). Without this
 * flag, callers must pick between (a) flashing a "Start call" button
 * during the loading window that could collide with a freshly-created
 * session, or (b) hiding the button until loading settles, which lets
 * the server-side 409 error toast do the talking.
 *
 * The provider keeps `session === null` while loading so existing
 * consumers that already key off `if (session)` don't need to change.
 * New code that wants the loading distinction should branch on
 * `isSessionLoading` BEFORE checking `session`.
 */
export type VideoCallContextValue = {
  workspaceId: Id<"workspaces"> | null;
  session: CurrentOrUpcomingSession | null;
  isSessionLoading: boolean;
  status: VideoCallStatus;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  isPictureInPicture: boolean;
  participantCount: number;
  remoteParticipantName: string | null;
  errorMessage: string | null;
  durationSeconds: number;
  join: () => Promise<void>;
  /**
   * Request that the provider auto-join the call once the given session
   * becomes active. Used by the Start Call button and deep-link flows so the
   * user who initiated the join is brought into the call without needing a
   * second click, while a user who merely opens a workspace with an active
   * call is not auto-joined.
   */
  requestJoin: (sessionId: Id<"sessions">) => void;
  leave: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => void;
  togglePictureInPicture: () => void;
};

export const VideoCallContext = createContext<VideoCallContextValue | null>(null);

export function useVideoCallContext(): VideoCallContextValue {
  const ctx = useContext(VideoCallContext);
  if (!ctx) {
    throw new Error(
      "useVideoCallContext must be used within a <VideoCallProvider>"
    );
  }
  return ctx;
}

/**
 * True while the user has an active (or in-progress) video call —
 * "joined", "joining", or "leaving". Centralizes the status check so
 * adding a new transient status (e.g. "reconnecting") updates every
 * consumer in one place instead of risking a missed search-and-replace
 * across the workspace surface.
 *
 * Returns `false` for "idle" and "error" so the workspace chrome
 * stays in its normal scroll-flow layout outside an active call.
 */
export function useIsInCall(): boolean {
  const { status } = useVideoCallContext();
  return status === "joined" || status === "joining" || status === "leaving";
}

/**
 * True when the modal call overlay should be visible — strictly
 * broader than `useIsInCall()`. Drives `<CallOverlay />` (and any
 * future modal-style call UI) so the overlay stays mounted across
 * every state where the user has clicked "Start call" or is in a
 * call, including the failed-join window.
 *
 * Returns true when:
 *   - `status` is "joining" / "joined" / "leaving" (call is live)
 *   - `status` is "error" AND `session` is non-null (join failed;
 *     user needs to see the error UI and the Retry/Leave buttons
 *     to recover)
 *   - `session.status` is "active" (user just clicked Start call;
 *     `markCallStarted` flipped the session, but the Daily join
 *     hasn't fired yet — or, in the React 18 batched-update case,
 *     `setStatus("joining")` and `setStatus("error")` were committed
 *     in the same render so the "joining" state is invisible to
 *     subscribers)
 *
 * The `status === "error" && session !== null` clause is the exit
 * path for the Leave button on the error UI. `useVideoCall.leave()`
 * fires `endCall` from the error short-circuit, which marks
 * `callEndedAt` server-side; the `["sessions"]` query refetch
 * resolves `session` to null; the overlay then unmounts cleanly.
 * Without the `session !== null` guard, the overlay would stay
 * mounted after Leave, trapping the user on the error UI.
 *
 * The `session.status === "active"` clause is the load-bearing piece
 * for the modal-must-appear-on-Start-call requirement. Without it,
 * the overlay relies on `setStatus("joining")` committing before the
 * join fetch resolves, which React 18 automatic batching collapses
 * into a single render with the terminal `setStatus` (joined OR
 * error). Tying visibility to the data layer's "active" signal makes
 * the overlay mount deterministically as soon as `markCallStarted`
 * succeeds.
 *
 * Workspace chrome gating (action row + `<WorkspaceTabs />`) keeps
 * using `useIsInCall()` so a failed join leaves the workspace
 * surface visible beneath the modal backdrop, giving the user
 * recovery context.
 */
export function useIsCallOverlayVisible(): boolean {
  const { status, session } = useVideoCallContext();
  return (
    status === "joining" ||
    status === "joined" ||
    status === "leaving" ||
    (status === "error" && session !== null)
  );
}
