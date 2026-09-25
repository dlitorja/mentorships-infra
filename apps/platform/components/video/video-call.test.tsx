// Unit tests for the HUC-48 audio diagnostic wiring in <VideoCall>.
//
// The fix in PR #874 surfaces Chrome autoplay-policy rejection of
// `audio.play()` as a user-visible toast plus a `reportError` event,
// and registers a click-to-retry path. Three regressions have hit
// this code path before:
//
// - Greptile round-2 P2: toast without a working recovery action.
// - Greptile round-3 P1: click listener removed itself after the first
//   failed retry, so a second click could not retry.
// - Greptile round-3 P2: the recovery toast outlived the call, leaving
//   the user staring at "Call audio isn't playing" after they left.
//
// These tests pin the current behavior so any of those regressions
// reappears as a CI failure rather than a silent prod incident.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// vi.mock factories are hoisted to the top of the file, so the closures
// cannot reference `vi.fn()` declared below. Use `vi.hoisted` to create
// the captures first, then the mock factories close over them.
const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastDismiss: vi.fn(),
  reportError: vi.fn(),
  dailyAudio: vi.fn(),
  dailyVideo: vi.fn(),
  useParticipantIds: vi.fn(),
  useScreenShare: vi.fn(),
  useParticipant: vi.fn(),
  useVideoCallContext: vi.fn(),
}));

vi.mock("@daily-co/daily-react", () => ({
  DailyAudio: (props: any) => {
    mocks.dailyAudio(props);
    return null;
  },
  DailyVideo: (props: any) => {
    mocks.dailyVideo(props);
    return null;
  },
  useParticipantIds: (...args: any[]) => mocks.useParticipantIds(...args),
  useParticipant: (id: string) => mocks.useParticipant(id),
  useScreenShare: () => mocks.useScreenShare(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: mocks.toastError,
    success: mocks.toastSuccess,
    dismiss: mocks.toastDismiss,
  }),
}));

vi.mock("@/lib/observability", () => ({
  reportError: mocks.reportError,
}));

vi.mock("@/lib/video/video-context", () => ({
  useVideoCallContext: () => mocks.useVideoCallContext(),
}));

vi.mock("@/components/video/video-controls", () => ({
  VideoControls: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => {
    return React.createElement("button", props, children);
  },
}));

vi.mock("lucide-react", () => ({
  PhoneOff: () => null,
  RefreshCw: () => null,
}));

// Imported AFTER mocks so the component module sees them.
import { VideoCall } from "./video-call";

const renderJoinedCall = (
  overrides: Partial<{ session: any }> = {},
) => {
  mocks.useVideoCallContext.mockReturnValue({
    status: "joined",
    session: { sessionId: "session_test", ...overrides.session },
    remoteParticipantName: "Remote",
    isPictureInPicture: false,
    join: vi.fn(),
    leave: vi.fn(),
    errorMessage: null,
    ...overrides,
  });
  mocks.useParticipantIds.mockReturnValue([]);
  mocks.useScreenShare.mockReturnValue({ screens: [] });
  mocks.useParticipant.mockReturnValue(null);
  return render(<VideoCall />);
};

const lastDailyAudioProps = (): any => {
  const calls = mocks.dailyAudio.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0];
};

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe("<VideoCall> HUC-48 audio diagnostic wiring", () => {
  it("renders <DailyAudio autoSubscribeActiveSpeaker> with onPlayFailed handler", () => {
    renderJoinedCall();
    const props = lastDailyAudioProps();
    expect(props.autoSubscribeActiveSpeaker).toBe(true);
    expect(typeof props.onPlayFailed).toBe("function");
  });

  it("fires a toast and reportError when onPlayFailed fires (diagnostic surface)", () => {
    renderJoinedCall();
    const props = lastDailyAudioProps();
    const event = {
      message: "The play() request was interrupted by a call to pause().",
      target: document.createElement("audio"),
    };
    act(() => {
      props.onPlayFailed(event);
    });
    // Toast
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    const toastArgs = mocks.toastError.mock.calls[0];
    expect(toastArgs[0]).toBe("Call audio isn't playing");
    expect(toastArgs[1]).toMatchObject({
      id: "audio-needs-gesture",
      duration: Number.POSITIVE_INFINITY,
    });
    expect(toastArgs[1].description).toContain("Click anywhere");
    // reportError
    expect(mocks.reportError).toHaveBeenCalledTimes(1);
    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "video-call.audio-play-failed",
        level: "warn",
        message: "Daily <DailyAudio> onPlayFailed fired",
        context: { sessionId: "session_test" },
      }),
    );
  });

  it("does NOT set retryAudioEl when the event target is not an HTMLAudioElement (avoids wired-up listener that would retry a non-existent element)", async () => {
    renderJoinedCall();
    const props = lastDailyAudioProps();
    // Pass an event whose target is something else (e.g. the DailyAudio
    // component itself, which is the most common Daily shape). The
    // component must still surface the toast + reportError but skip
    // registering a click-to-retry listener.
    act(() => {
      props.onPlayFailed({ message: "blocked", target: {} as unknown });
    });
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    // 1 diagnostic reportError from onPlayFailed. After this point we
    // assert no further reportError calls are made — if a click-to-retry
    // listener were wrongly registered, the click would attempt
    // `target.play()` and catch the resulting TypeError, surfacing an
    // additional `audio-retry-failed` reportError.
    expect(mocks.reportError).toHaveBeenCalledTimes(1);

    await act(async () => {
      await userEvent.setup().click(document.body);
    });

    // Still 1 — no retry-failed report fired.
    expect(mocks.reportError).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    // No second dismiss beyond what mount already produced.
    expect(
      mocks.toastDismiss.mock.calls.filter(
        (args) => args[0] === "audio-needs-gesture",
      ).length,
    ).toBeLessThanOrEqual(1);
  });

  it("falls back to 'unknown reason' when event.message is not a string", () => {
    renderJoinedCall();
    const props = lastDailyAudioProps();
    act(() => {
      props.onPlayFailed({ target: document.createElement("audio") });
    });
    // Assert the fallback string actually flows through to the reported
    // error. The component builds the message as:
    //   typeof e?.message === "string" ? e.message : "unknown reason"
    // and wraps it in `new Error(message)` before passing to reportError.
    const call = mocks.reportError.mock.calls[0][0];
    expect(call.source).toBe("video-call.audio-play-failed");
    expect(call.message).toBe("Daily <DailyAudio> onPlayFailed fired");
    expect((call.error as Error).message).toBe("unknown reason");
  });

  it("registers a click-retry listener after onPlayFailed and dismisses the toast + shows 'Audio restored' when retry succeeds (round-2 P2 guard)", async () => {
    renderJoinedCall();
    const audioEl = document.createElement("audio");
    audioEl.play = vi.fn().mockResolvedValue(undefined);
    const props = lastDailyAudioProps();
    act(() => {
      props.onPlayFailed({ message: "blocked", target: audioEl });
    });
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    // The diagnostic from onPlayFailed already counts as one reportError call.
    expect(mocks.reportError).toHaveBeenCalledTimes(1);
    expect(mocks.reportError).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: "video-call.audio-play-failed" }),
    );
    // Reset dismiss mock so the post-click assertion cannot be satisfied
    // by the mount-time dismiss call.
    mocks.toastDismiss.mockClear();

    await act(async () => {
      await userEvent.setup().click(document.body);
    });

    expect(audioEl.play).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Audio restored");
    expect(mocks.toastDismiss).toHaveBeenCalledWith("audio-needs-gesture");
    // Retry success should NOT add another reportError event — total stays at 1.
    expect(mocks.reportError).toHaveBeenCalledTimes(1);
    expect(mocks.reportError).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: "video-call.audio-play-failed" }),
    );
  });

  it("keeps the retry listener alive and reports when retryAudioEl.play() rejects (round-3 P1 guard)", async () => {
    renderJoinedCall();
    const audioEl = document.createElement("audio");
    audioEl.play = vi.fn().mockRejectedValue(new Error("still blocked"));
    const props = lastDailyAudioProps();
    act(() => {
      props.onPlayFailed({ message: "blocked", target: audioEl });
    });
    // 1 call: the onPlayFailed diagnostic.
    expect(mocks.reportError).toHaveBeenCalledTimes(1);

    const user = userEvent.setup();
    // First click — retry fails.
    await act(async () => {
      await user.click(document.body);
    });
    expect(audioEl.play).toHaveBeenCalledTimes(1);
    // 2 calls: diagnostic + first retry-failed.
    expect(mocks.reportError).toHaveBeenCalledTimes(2);
    expect(mocks.reportError).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: "video-call.audio-retry-failed",
        level: "warn",
      }),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    // The persistent recovery toast stays up while the user can still retry.
    // (The useEffect on retryAudioEl === null dismisses it, but that only
    // runs when retryAudioEl flips back to null — which hasn't happened yet
    // because the retry keeps failing.)

    // Second click — listener was NOT removed on the first failure, so
    // a fresh attempt is made. If someone 'fixes' the listener with
    // `{ once: true }`, this second click is a no-op and the regression
    // surfaces here.
    await act(async () => {
      await user.click(document.body);
    });
    expect(audioEl.play).toHaveBeenCalledTimes(2);
    // 3 calls: diagnostic + retry-failed x2.
    expect(mocks.reportError).toHaveBeenCalledTimes(3);
  });

  it("dismisses the persistent recovery toast when the component unmounts mid-retry (round-3 P2 guard)", async () => {
    const { unmount } = renderJoinedCall();
    const audioEl = document.createElement("audio");
    audioEl.play = vi.fn().mockResolvedValue(undefined);
    const props = lastDailyAudioProps();
    act(() => {
      props.onPlayFailed({ message: "blocked", target: audioEl });
    });
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    // After mount the useEffect for retryAudioEl === null fires once,
    // dismissing any pre-existing toast. Reset the dismissal mock now
    // so the post-unmount assertion cannot be satisfied by that mount-
    // time call. Without this reset, the test would pass even if the
    // cleanup branch was removed.
    mocks.toastDismiss.mockClear();
    // Unmount (e.g. user leaves the call before clicking). The cleanup
    // branch in the retry useEffect must dismiss the persistent toast
    // so the user is not left staring at "Call audio isn't playing"
    // for a call they have already left.
    act(() => {
      unmount();
    });
    expect(mocks.toastDismiss).toHaveBeenCalledTimes(1);
    expect(mocks.toastDismiss).toHaveBeenCalledWith("audio-needs-gesture");
  });

  it("includes the live session id in the reportError context", () => {
    renderJoinedCall({ session: { sessionId: "session_xyz" } });
    const props = lastDailyAudioProps();
    act(() => {
      props.onPlayFailed({
        message: "blocked",
        target: document.createElement("audio"),
      });
    });
    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { sessionId: "session_xyz" },
      }),
    );
  });

  it("falls back to sessionId=null when there is no live session", () => {
    mocks.useVideoCallContext.mockReturnValue({
      status: "joined",
      session: null,
      remoteParticipantName: null,
      isPictureInPicture: false,
      join: vi.fn(),
      leave: vi.fn(),
      errorMessage: null,
    });
    mocks.useParticipantIds.mockReturnValue([]);
    mocks.useScreenShare.mockReturnValue({ screens: [] });
    mocks.useParticipant.mockReturnValue(null);
    render(<VideoCall />);
    const props = lastDailyAudioProps();
    act(() => {
      props.onPlayFailed({
        message: "blocked",
        target: document.createElement("audio"),
      });
    });
    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { sessionId: null },
      }),
    );
  });
});
