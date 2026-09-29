// Unit tests for `<ParticipantIndicator>` (platform-call-bugs).
// The chip surfaces the current participant count + the remote
// participant's name during a video call, mounted inside
// `<CallOverlay>`'s header row. Daily.co does not ship a built-in
// participant-list chip in `@daily-co/daily-react@0.25.3`, so we
// render our own and read state from `useVideoCallContext()`.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  useVideoCallContext: vi.fn(),
}));

vi.mock("@/lib/video/video-context", () => ({
  useVideoCallContext: () => mocks.useVideoCallContext(),
}));

// Imported AFTER mocks so the component module sees them.
import { ParticipantIndicator } from "./participant-indicator";

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
});

const renderIndicator = (
  overrides: Partial<{
    participantCount: number;
    remoteParticipantName: string | null;
  }> = {}
) => {
  mocks.useVideoCallContext.mockReturnValue({
    participantCount: overrides.participantCount ?? 0,
    remoteParticipantName: overrides.remoteParticipantName ?? null,
  });
  return render(<ParticipantIndicator />);
};

describe("<ParticipantIndicator> (platform-call-bugs)", () => {
  it("returns null when participantCount is zero (call not joined yet)", () => {
    const { container } = renderIndicator({ participantCount: 0 });
    expect(container.firstChild).toBeNull();
  });

  it("shows 'Just you' when only the local participant is present", () => {
    const { getByTestId, getByText } = renderIndicator({
      participantCount: 1,
      remoteParticipantName: null,
    });
    expect(getByTestId("participant-indicator")).toBeTruthy();
    expect(getByText("Just you")).toBeTruthy();
    expect(getByTestId("participant-indicator").getAttribute("data-participant-count")).toBe("1");
  });

  it("shows the remote participant name when exactly two are present", () => {
    const { getByTestId } = renderIndicator({
      participantCount: 2,
      remoteParticipantName: "Alex",
    });
    expect(getByTestId("participant-indicator").textContent).toContain("Alex");
  });

  it("shows 'name + N more' when more than two are present", () => {
    const { getByText } = renderIndicator({
      participantCount: 4,
      remoteParticipantName: "Alex",
    });
    expect(getByText("Alex + 3 more")).toBeTruthy();
  });

  it("falls back to '{count} in call' when remoteParticipantName is null and count > 1", () => {
    const { getByText } = renderIndicator({
      participantCount: 3,
      remoteParticipantName: null,
    });
    expect(getByText("3 in call")).toBeTruthy();
  });
});
