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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  reportInfo: vi.fn(),
  getVideoToken: vi.fn(),
  dailyParticipantsJoinedHandlers: [] as Array<(evt: unknown) => void>,
  dailyParticipantsLeftHandlers: [] as Array<(evt: unknown) => void>,
  dailyScreenShareStartedHandlers: [] as Array<(evt: unknown) => void>,
  dailyScreenShareCanceledHandlers: [] as Array<(evt: unknown) => void>,
  dailyScreenShareStoppedHandlers: [] as Array<(evt: unknown) => void>,
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
    } else if (eventName === "local-screen-share-started") {
      mocks.dailyScreenShareStartedHandlers.push(handler);
    } else if (eventName === "local-screen-share-canceled") {
      mocks.dailyScreenShareCanceledHandlers.push(handler);
    } else if (eventName === "local-screen-share-stopped") {
      mocks.dailyScreenShareStoppedHandlers.push(handler);
    }
  },
  useMeetingState: () => mocks.useMeetingState(),
  useScreenShare: () => mocks.useScreenShare(),
}));

const mutationRegistry = vi.hoisted(() => ({
  endCall: { mutateAsync: vi.fn() },
  prepareCallPresenceMessage: { mutate: vi.fn() },
  recordCallPresenceMessage: { mutate: vi.fn() },
  callIndex: 0,
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (_config: {
    mutationFn: unknown;
    onSuccess?: () => void;
    onError?: (err: unknown) => void;
  }) => {
    // PR platform-call-bugs round 7 P1+Security: the hook now
    // uses THREE mutations (endCall, prepareCallPresenceMessage,
    // recordCallPresenceMessage). Cycle 1/2/3 across the three
    // registry entries based on call order. The order matches
    // the hook's `useMutation` invocation order.
    mutationRegistry.callIndex += 1;
    const idx = (mutationRegistry.callIndex - 1) % 3;
    if (idx === 0) return mutationRegistry.endCall;
    if (idx === 1) return mutationRegistry.prepareCallPresenceMessage;
    return mutationRegistry.recordCallPresenceMessage;
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
  reportInfo: mocks.reportInfo,
}));

vi.mock("@/lib/queries/api-client", () => ({
  getVideoToken: mocks.getVideoToken,
}));

// Imported AFTER mocks so the hook module sees them.
import { toast } from "sonner";
import { useVideoCall } from "./use-video-call";
import {
  SCREEN_SHARE_DID_NOT_START_MESSAGE,
  SCREEN_SHARE_PICKER_DID_NOT_OPEN_MESSAGE,
  SCREEN_SHARE_UNSUPPORTED_MESSAGE,
} from "@/lib/video/screen-share-support";

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
  mocks.dailyScreenShareStartedHandlers.length = 0;
  mocks.dailyScreenShareCanceledHandlers.length = 0;
  mocks.dailyScreenShareStoppedHandlers.length = 0;
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
  // PR platform-call-bugs round 7 P1+Security: the prepare
  // mutation returns a nonce id; the record mutation is then
  // invoked inside the prepare's onSuccess callback. Simulate
  // the chain by having prepare's mock immediately call
  // onSuccess with a fake nonce id and forward to record.
  mutationRegistry.prepareCallPresenceMessage.mutate.mockImplementation(
    (args: unknown, handlers?: { onSuccess?: (id: unknown) => void }) => {
      handlers?.onSuccess?.("nonce_test_id");
    }
  );
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
    //
    // PR platform-call-bugs round 7 P1+Security: the record
    // mutation now also receives a `nonceId` minted by the
    // prepare mutation. The mock above simulates the prepare →
    // onSuccess(nonceId) → record chain, so we assert the nonce
    // is forwarded.
    expect(mutationRegistry.prepareCallPresenceMessage.mutate).toHaveBeenCalledWith(
      { workspaceId: "ws_xyz", sessionId: "session_xyz", kind: "joined" },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
    expect(mutationRegistry.recordCallPresenceMessage.mutate).toHaveBeenCalledWith({
      workspaceId: "ws_xyz",
      sessionId: "session_xyz",
      kind: "joined",
      nonceId: "nonce_test_id",
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

    expect(mutationRegistry.prepareCallPresenceMessage.mutate).toHaveBeenCalledWith(
      { workspaceId: "ws_xyz", sessionId: "session_xyz", kind: "left" },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
    expect(mutationRegistry.recordCallPresenceMessage.mutate).toHaveBeenCalledWith({
      workspaceId: "ws_xyz",
      sessionId: "session_xyz",
      kind: "left",
      nonceId: "nonce_test_id",
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

// Screen-share capability regression tests.
//
// A production instructor on an iPad reported the screen-share button
// "not working". Root cause: iPadOS Safari before 27 does not expose
// `navigator.mediaDevices.getDisplayMedia`, and Daily's
// `startScreenShare()` is a documented no-op in that case — no start,
// stop, cancel, or error event fires, so the old code produced zero
// feedback. These tests pin the two feedback paths that replace the
// silent failure:
//   1. Tap-time capability check → explanatory toast, Daily not called.
//   2. Watchdog when the API exists but the platform never reports an
//      outcome → "didn't start" toast.
describe("useVideoCall — screen share capability", () => {
  const originalMediaDevices = Object.getOwnPropertyDescriptor(
    navigator,
    "mediaDevices"
  );
  const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(
    navigator,
    "maxTouchPoints"
  );
  const originalUserAgent = Object.getOwnPropertyDescriptor(
    navigator,
    "userAgent"
  );

  const setMediaDevices = (value: unknown): void => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value,
    });
  };

  /**
   * Simulate an iPad. iPadOS reports a desktop Macintosh user agent, so
   * both the UA and the touch points have to match.
   */
  const setTouchPrimaryDevice = (): void => {
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 5,
    });
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15",
    });
  };

  /**
   * Minimal stand-in for a getDisplayMedia stream: the hook only reads
   * tracks, stops them, and listens for the video track's `ended` event.
   */
  const makeScreenStream = () => {
    const listeners: Record<string, () => void> = {};
    const track = {
      kind: "video",
      stop: vi.fn(),
      addEventListener: vi.fn((name: string, cb: () => void) => {
        listeners[name] = cb;
      }),
      removeEventListener: vi.fn(),
    };
    const stream = {
      getVideoTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream;
    return { stream, track, listeners };
  };

  afterEach(() => {
    vi.useRealTimers();
    if (originalMediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
    } else {
      delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    }
    if (originalMaxTouchPoints) {
      Object.defineProperty(
        navigator,
        "maxTouchPoints",
        originalMaxTouchPoints
      );
    } else {
      delete (navigator as { maxTouchPoints?: unknown }).maxTouchPoints;
    }
    if (originalUserAgent) {
      Object.defineProperty(navigator, "userAgent", originalUserAgent);
    }
  });

  it("explains the limitation and does not call Daily when getDisplayMedia is missing (iPadOS <= 26)", () => {
    setMediaDevices({});
    const { ref } = renderHook();

    act(() => {
      ref.current!.toggleScreenShare();
    });

    expect(mocks.startScreenShare).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Screen sharing isn't available",
      expect.objectContaining({
        id: "screen-share-unsupported",
        description: SCREEN_SHARE_UNSUPPORTED_MESSAGE,
      })
    );
    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "useVideoCall.toggleScreenShare.unsupported",
        level: "warn",
      })
    );
  });

  it("reports the unsupported environment only once per session but re-toasts each tap", () => {
    setMediaDevices({});
    const { ref } = renderHook();

    act(() => {
      ref.current!.toggleScreenShare();
    });
    act(() => {
      ref.current!.toggleScreenShare();
    });

    const unsupportedReports = mocks.reportError.mock.calls.filter(
      ([arg]) =>
        (arg as { source?: string }).source ===
        "useVideoCall.toggleScreenShare.unsupported"
    );
    expect(unsupportedReports).toHaveLength(1);
    // The user still needs feedback on every tap.
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it("uses Daily's default capture on desktop", async () => {
    const getDisplayMedia = vi.fn();
    setMediaDevices({ getDisplayMedia });
    const { ref } = renderHook();

    await act(async () => {
      ref.current!.toggleScreenShare();
    });

    expect(mocks.startScreenShare).toHaveBeenCalledTimes(1);
    expect(mocks.startScreenShare).toHaveBeenCalledWith();
    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalledWith(
      "Screen sharing isn't available",
      expect.anything()
    );
  });

  it("captures the screen itself and hands the stream to Daily on a touch device (iPadOS 27+)", async () => {
    const { stream, track } = makeScreenStream();
    const getDisplayMedia = vi.fn().mockResolvedValue(stream);
    setMediaDevices({ getDisplayMedia });
    setTouchPrimaryDevice();
    const { ref } = renderHook();

    await act(async () => {
      ref.current!.toggleScreenShare();
    });
    await act(async () => {});

    expect(getDisplayMedia).toHaveBeenCalledWith({ video: true });
    expect(mocks.startScreenShare).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaStream: stream,
        screenVideoSendSettings: "motion-and-detail-balanced",
      })
    );
    expect(mocks.reportInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "useVideoCall.toggleScreenShare.selfCapture",
      })
    );
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("releases the self-captured stream when Daily never reports an outcome", async () => {
    vi.useFakeTimers();
    const { stream, track } = makeScreenStream();
    setMediaDevices({ getDisplayMedia: vi.fn().mockResolvedValue(stream) });
    setTouchPrimaryDevice();
    const { ref } = renderHook();

    await act(async () => {
      ref.current!.toggleScreenShare();
    });
    await act(async () => {});
    expect(track.stop).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Screen sharing hasn't started",
      expect.objectContaining({
        id: "screen-share-did-not-start",
        description: SCREEN_SHARE_DID_NOT_START_MESSAGE,
      })
    );
    // Do not keep capturing the screen once we told the user nothing is
    // shared.
    expect(track.stop).toHaveBeenCalled();
    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "useVideoCall.toggleScreenShare.timeout",
        level: "warn",
      })
    );
  });

  it("reports a touch picker that never appears", async () => {
    vi.useFakeTimers();
    setMediaDevices({
      // Never resolves: simulates iPadOS 27 exposing the API but never
      // showing a system picker.
      getDisplayMedia: vi.fn(() => new Promise<MediaStream>(() => {})),
    });
    setTouchPrimaryDevice();
    const { ref } = renderHook();

    await act(async () => {
      ref.current!.toggleScreenShare();
    });
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Screen sharing hasn't started",
      expect.objectContaining({
        id: "screen-share-did-not-start",
        description: SCREEN_SHARE_PICKER_DID_NOT_OPEN_MESSAGE,
      })
    );
    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "useVideoCall.toggleScreenShare.captureTimeout",
      })
    );
  });

  it("does not toast when Daily reports the share started", async () => {
    vi.useFakeTimers();
    const { stream } = makeScreenStream();
    setMediaDevices({ getDisplayMedia: vi.fn().mockResolvedValue(stream) });
    setTouchPrimaryDevice();
    const { ref } = renderHook();

    await act(async () => {
      ref.current!.toggleScreenShare();
    });
    await act(async () => {});
    act(() => {
      mocks.dailyScreenShareStartedHandlers.forEach((handler) => handler({}));
    });

    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });

    expect(toast.error).not.toHaveBeenCalledWith(
      "Screen sharing hasn't started",
      expect.anything()
    );
  });

  it("releases the self-captured stream when Daily cancels the share", async () => {
    vi.useFakeTimers();
    const { stream, track } = makeScreenStream();
    setMediaDevices({ getDisplayMedia: vi.fn().mockResolvedValue(stream) });
    setTouchPrimaryDevice();
    const { ref } = renderHook();

    await act(async () => {
      ref.current!.toggleScreenShare();
    });
    await act(async () => {});
    act(() => {
      mocks.dailyScreenShareCanceledHandlers.forEach((handler) => handler({}));
    });

    expect(track.stop).toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });
    expect(toast.error).not.toHaveBeenCalledWith(
      "Screen sharing hasn't started",
      expect.anything()
    );
  });

  it("treats a dismissed picker as a cancellation, not an error", async () => {
    vi.useFakeTimers();
    const getDisplayMedia = vi
      .fn()
      .mockRejectedValue(new DOMException("dismissed", "NotAllowedError"));
    setMediaDevices({ getDisplayMedia });
    setTouchPrimaryDevice();
    const { ref } = renderHook();

    await act(async () => {
      ref.current!.toggleScreenShare();
    });
    await act(async () => {});

    expect(mocks.startScreenShare).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalledWith(
      "Screen share failed",
      expect.anything()
    );
    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "useVideoCall.toggleScreenShare.capture.dismissed",
        level: "warn",
      })
    );

    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });
    expect(toast.error).not.toHaveBeenCalledWith(
      "Screen sharing hasn't started",
      expect.anything()
    );
  });

  it("discards a capture that resolves after the call was left (Greptile P1)", async () => {
    let resolveCapture: ((stream: MediaStream) => void) | null = null;
    const pending = new Promise<MediaStream>((resolve) => {
      resolveCapture = resolve;
    });
    setMediaDevices({ getDisplayMedia: vi.fn(() => pending) });
    setTouchPrimaryDevice();
    const { ref, setMeetingState } = renderHook();
    setMeetingState("joined-meeting");

    await act(async () => {
      ref.current!.toggleScreenShare();
    });
    // Leave while the system picker is still open.
    await act(async () => {
      await ref.current!.leave();
    });
    // The picker now resolves.
    const lateCapture = makeScreenStream();
    await act(async () => {
      resolveCapture?.(lateCapture.stream);
    });
    await act(async () => {});

    expect(mocks.startScreenShare).not.toHaveBeenCalled();
    expect(lateCapture.track.stop).toHaveBeenCalled();
  });

  it("ignores a second tap while a capture is pending (Greptile P2)", async () => {
    const getDisplayMedia = vi.fn(() => new Promise<MediaStream>(() => {}));
    setMediaDevices({ getDisplayMedia });
    setTouchPrimaryDevice();
    const { ref } = renderHook();

    await act(async () => {
      ref.current!.toggleScreenShare();
    });
    await act(async () => {
      ref.current!.toggleScreenShare();
    });

    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(mocks.startScreenShare).not.toHaveBeenCalled();
  });

  it("stops sharing when Safari's system 'Stop sharing' ends the track", async () => {
    const { stream, track, listeners } = makeScreenStream();
    setMediaDevices({ getDisplayMedia: vi.fn().mockResolvedValue(stream) });
    setTouchPrimaryDevice();
    const { ref } = renderHook();

    await act(async () => {
      ref.current!.toggleScreenShare();
    });
    await act(async () => {});

    act(() => {
      listeners.ended?.();
    });

    expect(track.stop).toHaveBeenCalled();
    expect(mocks.stopScreenShare).toHaveBeenCalled();
  });

  it("releases the stream and clears the watchdog when the call is left", async () => {
    vi.useFakeTimers();
    const { stream, track } = makeScreenStream();
    setMediaDevices({ getDisplayMedia: vi.fn().mockResolvedValue(stream) });
    setTouchPrimaryDevice();
    const { ref, setMeetingState } = renderHook();
    setMeetingState("joined-meeting");

    await act(async () => {
      ref.current!.toggleScreenShare();
    });
    await act(async () => {});
    await act(async () => {
      await ref.current!.leave();
    });

    expect(track.stop).toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });
    expect(toast.error).not.toHaveBeenCalledWith(
      "Screen sharing hasn't started",
      expect.anything()
    );
    expect(mocks.reportError).not.toHaveBeenCalledWith(
      expect.objectContaining({
        source: "useVideoCall.toggleScreenShare.timeout",
      })
    );
  });

  it("does not arm the watchdog on a desktop (slow picker must not false-alarm)", async () => {
    vi.useFakeTimers();
    setMediaDevices({ getDisplayMedia: vi.fn() });
    const { ref } = renderHook();

    await act(async () => {
      ref.current!.toggleScreenShare();
    });

    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });

    expect(toast.error).not.toHaveBeenCalledWith(
      "Screen sharing hasn't started",
      expect.anything()
    );
    expect(mocks.reportError).not.toHaveBeenCalledWith(
      expect.objectContaining({
        source: "useVideoCall.toggleScreenShare.timeout",
      })
    );
  });
});
