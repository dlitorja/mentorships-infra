// Regression tests for the picture-in-picture drag surface.
//
// The panel drags itself by calling `setPointerCapture` on pointerdown.
// Doing that for *every* pointerdown retargeted the whole gesture (and
// the compatibility `click`) to the container, so the call controls
// rendered inside the panel — mute, camera, screen share, leave —
// never received their onClick. Tablets (600–900px) live in PiP
// permanently, so an iPad instructor saw a screen-share button that did
// nothing at all. Verified against Chromium: a captured pointer produced
// `clicks: 0` on a nested button.
//
// These tests pin the rule: drag capture starts only when the gesture
// begins outside an interactive control.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  togglePictureInPicture: vi.fn(),
  leave: vi.fn(),
  shareClick: vi.fn(),
}));

vi.mock("@/components/video/video-call", () => ({
  VideoCall: () => (
    <button type="button" data-testid="share-control" onClick={mocks.shareClick}>
      Share
    </button>
  ),
}));

vi.mock("@/lib/video/video-context", () => ({
  useVideoCallContext: () => ({
    togglePictureInPicture: mocks.togglePictureInPicture,
    leave: mocks.leave,
    remoteParticipantName: "Student",
    status: "joined",
  }),
}));

// Imported after the mocks so the component sees them.
import { PictureInPicture } from "./picture-in-picture";

const getPanel = (): HTMLElement => screen.getByRole("dialog");

describe("<PictureInPicture> drag capture", () => {
  let setPointerCapture: ReturnType<typeof vi.fn>;
  let releasePointerCapture: ReturnType<typeof vi.fn>;
  let hasPointerCapture: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setPointerCapture = vi.fn();
    releasePointerCapture = vi.fn();
    hasPointerCapture = vi.fn(() => true);
    // jsdom does not implement the Pointer Capture API.
    Element.prototype.setPointerCapture = setPointerCapture;
    Element.prototype.releasePointerCapture = releasePointerCapture;
    Element.prototype.hasPointerCapture = hasPointerCapture;
  });

  afterEach(() => {
    cleanup();
    // @ts-expect-error -- jsdom does not declare these on Element.
    delete Element.prototype.setPointerCapture;
    // @ts-expect-error -- jsdom does not declare these on Element.
    delete Element.prototype.releasePointerCapture;
    // @ts-expect-error -- jsdom does not declare these on Element.
    delete Element.prototype.hasPointerCapture;
  });

  it("does not capture the pointer when the tap starts on a control", async () => {
    render(<PictureInPicture />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("share-control"));

    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(mocks.shareClick).toHaveBeenCalledTimes(1);
  });

  it("captures the pointer when the drag starts on the panel surface", () => {
    render(<PictureInPicture />);

    fireEvent.pointerDown(getPanel(), { pointerId: 7, clientX: 10, clientY: 10 });

    expect(setPointerCapture).toHaveBeenCalledWith(7);
  });
});
