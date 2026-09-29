// Unit tests for `useVideoCall`'s self-authored call-presence
// behavior (PR platform-call-bugs round 2).
//
// Greptile flagged two P2 issues with the original implementation
// in PR #1 of this slice:
//   1. `participantCount` started at 0 because Daily does not fire
//      `participant-joined` for the local user on join — the
//      indicator chip stayed hidden until a remote joiner arrived,
//      and even then could undercount.
//   2. Workspace chat missed the first join (no observer) AND the
//      last leave (no observer) because system messages were
//      written only from `participant-joined` / `participant-left`
//      events with `!evt.participant.local`.
//
// The fix:
//   - `join()`'s success path sets `participantCount(1)` and posts a
//     self-authored "joined" system message via Clerk's
//     `user.fullName`.
//   - `leave()`'s success path sets `participantCount(0)` and posts
//     a self-authored "left" system message.
//   - Observer `participant-joined` / `participant-left` handlers
//     only adjust the count; they no longer write system messages.
//     This eliminates duplicate messages when both A and B are
//     present (each writes their own event exactly once).
//
// These tests pin those three behaviors so a future "fix" cannot
// silently reintroduce the round-1 bug.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  dailyJoin: vi.fn(),
  dailyLeave: vi.fn(),
  meetingState: vi.fn(),
  localAudio: vi.fn(),
  localVideo: vi.fn(),
  setLocalAudio: vi.fn(),
  setLocalVideo: vi.fn(),
  startScreenShare: vi.fn(),
  stopScreenShare: vi.fn(),
  useDaily: vi.fn(),
  useDailyEvent: vi.fn(),
  useMeetingState: vi.fn(),
  useScreenShare: vi.fn(),
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
  useConvexMutation: vi.fn(),
  reportError: vi.fn(),
  getVideoToken: vi.fn(),
  dailyParticipantsJoinedHandlers: [] as Array<(evt: unknown) => void>,
  dailyParticipantsLeftHandlers: [] as Array<(evt: unknown) => void>,
}));

vi.mock("@daily-co/daily-react", () => ({
  useDaily: () => mocks.useDaily(),
  useDailyEvent: (
    eventName: string,
    handler: (evt: unknown) => void,
  ) => {
    if (eventName === "participant-joined") {
      mocks.dailyParticipantsJoinedHandlers.push(handler);
    } else if (eventName === "participant-left") {
      mocks.dailyParticipantsLeftHandlers.push(handler);
    }
  },
  useMeetingState: () => mocks.useMeetingState(),
  useScreenShare: () => mocks.useScreenShare(),
}));

const mutationRegistry = vi.hoisted(() => ({
  endCall: { mutateAsync: vi.fn() },
  recordCallPresenceMessage: { mutate: vi.fn() },
  callIndex: 0,
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (_config: {
    mutationFn: unknown;
    onSuccess?: () => void;
    onError?: (err: unknown) => void;
  }) => {
    // `useMutation` is called twice in the hook: once for `endCall`
    // and once for `recordCallPresenceMessage`. We can't easily
    // distinguish them by `config.mutationFn` (it's a closure),
    // so we cycle through the registry based on call index.
    mutationRegistry.callIndex += 1;
    return mutationRegistry.callIndex % 2 === 1
      ? mutationRegistry.endCall
      : mutationRegistry.recordCallPresenceMessage;
  },
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock("@convex-dev/react-query", () => ({
  useConvexMutation: (fn: unknown) => () => fn,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/lib/observability", () => ({
  reportError: mocks.reportError,
}));

vi.mock("@/lib/queries/api-client", () => ({
  getVideoToken: mocks.getVideoToken,
}));

// Imported AFTER mocks so the hook module sees them.
import { useVideoCall } from "./use-video-call";

const renderHook = (
  options: Partial<{
    enabled: boolean;
    workspaceId: string | null;
    sessionId: string | null;
    roomName: string | null;
  }> = {}
) => {
  const ref = { current: null as ReturnType<typeof useVideoCall> | null };
  let rerenderFn: ((props?: object) => void) | null = null;
  const Probe = () => {
    ref.current = useVideoCall({
      enabled: options.enabled ?? true,
      workspaceId:
        (options.workspaceId ?? "ws_test") as never,
      sessionId: (options.sessionId ?? "session_test") as never,
      roomName: options.roomName ?? "room_test",
    });
    return null;
  };
  const result = render(<Probe />);
  rerenderFn = result.rerender;
  // Wrap so callers can `setMeetingState(...)` and then trigger a
  // re-render so the hook's `leave()` callback sees the new value.
  const setMeetingStateAndRerender = (state: string) => {
    mocks.useMeetingState.mockReturnValue(state);
    mocks.meetingState.mockReturnValue(state);
    rerenderFn!(<Probe />);
  };
  return {
    ref: ref as { current: ReturnType<typeof useVideoCall> | null },
    setMeetingState: setMeetingStateAndRerender,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mutationRegistry.callIndex = 0;
  mocks.dailyParticipantsJoinedHandlers.length = 0;
  mocks.dailyParticipantsLeftHandlers.length = 0;
  mocks.useDaily.mockReturnValue({
    join: mocks.dailyJoin.mockResolvedValue(undefined),
    leave: mocks.dailyLeave.mockResolvedValue(undefined),
    localAudio: mocks.localAudio.mockReturnValue(false),
    localVideo: mocks.localVideo.mockReturnValue(false),
    setLocalAudio: mocks.setLocalAudio,
    setLocalVideo: mocks.setLocalVideo,
    meetingState: mocks.meetingState.mockReturnValue("new"),
  });
  // Default to "new" so the join() re-entrancy guard doesn't trip
  // when a test calls join() on a fresh hook. Tests that need
  // leave() to actually run flip the mock to "joined-meeting"
  // BEFORE calling leave().
  mocks.useMeetingState.mockReturnValue("new");
  mocks.useScreenShare.mockReturnValue({
    isSharingScreen: false,
    screens: [],
    startScreenShare: mocks.startScreenShare.mockResolvedValue(undefined),
    stopScreenShare: mocks.stopScreenShare.mockResolvedValue(undefined),
  });
  mocks.getVideoToken.mockResolvedValue({ token: "token_test" });
  mocks.meetingState.mockReturnValue("new");
  mutationRegistry.endCall.mutateAsync.mockResolvedValue({});
  mutationRegistry.recordCallPresenceMessage.mutate.mockClear();
  cleanup();
});

describe("useVideoCall — PR platform-call-bugs round 2 fixes", () => {
  it("initializes participantCount to 1 after local join() succeeds (Greptile P2 #1)", async () => {
    const { ref } = renderHook();
    expect(ref.current!.participantCount).toBe(0);

    await act(async () => {
      await ref.current!.join();
    });

    // Daily would normally flip meetingState to "joined-meeting"
    // after join resolves, but we're not driving that effect here —
    // the functional `setParticipantCount((prev) => prev + 1)`
    // inside the join success path is the regression guard.
    // Greptile round 5 P2: this update uses a functional form so a
    // remote joiner who fired `participant-joined` during the local
    // pending period is preserved (count becomes 2, not reset to 1).
    expect(ref.current!.participantCount).toBe(1);
  });

  it("posts a self-authored 'joined' system message after local join() succeeds (Greptile P2 #2)", async () => {
    const { ref } = renderHook({
      workspaceId: "ws_xyz",
      sessionId: "session_xyz",
    });
    expect(mutationRegistry.recordCallPresenceMessage.mutate).not.toHaveBeenCalled();

    await act(async () => {
      await ref.current!.join();
    });

    // Greptile round 3: the actor name is resolved server-side
    // from the caller's `users` row — the client does NOT supply
    // a `systemActorName`. A malicious participant cannot
    // impersonate someone else in chat via this mutation.
    expect(mutationRegistry.recordCallPresenceMessage.mutate).toHaveBeenCalledWith({
      workspaceId: "ws_xyz",
      sessionId: "session_xyz",
      kind: "joined",
    });
  });

  it("posts a self-authored 'left' system message after leave() succeeds (Greptile P2 #2)", async () => {
    const { ref, setMeetingState } = renderHook({
      workspaceId: "ws_xyz",
      sessionId: "session_xyz",
    });
    setMeetingState("joined-meeting");

    await act(async () => {
      await ref.current!.leave();
    });

    expect(mutationRegistry.recordCallPresenceMessage.mutate).toHaveBeenCalledWith({
      workspaceId: "ws_xyz",
      sessionId: "session_xyz",
      kind: "left",
    });
  });

  it("resets participantCount to 0 after local leave() succeeds (Greptile P2 #1)", async () => {
    const { ref, setMeetingState } = renderHook();
    await act(async () => {
      await ref.current!.join();
    });
    expect(ref.current!.participantCount).toBe(1);
    setMeetingState("joined-meeting");

    await act(async () => {
      await ref.current!.leave();
    });
    expect(ref.current!.participantCount).toBe(0);
  });

  it("does NOT post a system message from a participant-joined observer event (avoids dup)", async () => {
    renderHook();
    // Pretend a remote participant just joined.
    act(() => {
      mocks.dailyParticipantsJoinedHandlers.forEach((h) =>
        h({
          participant: {
            session_id: "remote_session_1",
            user_name: "Remote",
            local: false,
          },
        }),
      );
    });
    expect(mutationRegistry.recordCallPresenceMessage.mutate).not.toHaveBeenCalled();
  });

  it("does NOT post a system message from a participant-left observer event (avoids dup)", async () => {
    renderHook();
    act(() => {
      mocks.dailyParticipantsLeftHandlers.forEach((h) =>
        h({
          participant: {
            session_id: "remote_session_1",
            user_name: "Remote",
            local: false,
          },
        }),
      );
    });
    expect(mutationRegistry.recordCallPresenceMessage.mutate).not.toHaveBeenCalled();
  });

  it("skips a participant-joined event whose local flag is true (defensive: Daily could start firing these)", async () => {
    const { ref } = renderHook();
    await act(async () => {
      await ref.current!.join();
    });
    expect(ref.current!.participantCount).toBe(1);
    mutationRegistry.recordCallPresenceMessage.mutate.mockClear();

    // If Daily were to fire participant-joined for the local user
    // (it currently does not), the handler must short-circuit so
    // we do not double-count to 2 or duplicate the join message.
    act(() => {
      mocks.dailyParticipantsJoinedHandlers.forEach((h) =>
        h({
          participant: {
            session_id: "local_session_id",
            user_name: "Alex Student",
            local: true,
          },
        }),
      );
    });

    expect(ref.current!.participantCount).toBe(1);
    expect(mutationRegistry.recordCallPresenceMessage.mutate).not.toHaveBeenCalled();
  });
});
