import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isScreenSharePickerDismissal,
  isScreenShareSupported,
  isTouchPrimaryDevice,
} from "@/lib/video/screen-share-support";

/**
 * `isScreenShareSupported` gates the tap-time screen-share check in
 * `useVideoCall`. It must answer `false` for the exact shapes that Daily
 * treats as a silent no-op: no `mediaDevices` (insecure origin), and
 * `mediaDevices` without `getDisplayMedia` (iPadOS < 27, Android).
 */
describe("isScreenShareSupported", () => {
  const originalMediaDevices = Object.getOwnPropertyDescriptor(
    navigator,
    "mediaDevices"
  );

  const setMediaDevices = (value: unknown): void => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value,
    });
  };

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalMediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
    } else {
      delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    }
  });

  it("returns false when mediaDevices is unavailable (insecure origin)", () => {
    setMediaDevices(undefined);
    expect(isScreenShareSupported()).toBe(false);
  });

  it("returns false when getDisplayMedia is missing (iPadOS < 27, Android)", () => {
    setMediaDevices({ getUserMedia: vi.fn() });
    expect(isScreenShareSupported()).toBe(false);
  });

  it("returns true when getDisplayMedia is a function (desktop, iPadOS 27+)", () => {
    setMediaDevices({ getDisplayMedia: vi.fn() });
    expect(isScreenShareSupported()).toBe(true);
  });
});

/**
 * `isTouchPrimaryDevice` only decides whether the screen-share watchdog
 * is armed, so a false positive costs a spurious toast while a slow user
 * is still picking a window. iPadOS Safari reports a desktop "Macintosh"
 * user agent, so touch points are the signal that matters most.
 */
describe("isTouchPrimaryDevice", () => {
  const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(
    navigator,
    "maxTouchPoints"
  );
  const originalUserAgent = Object.getOwnPropertyDescriptor(
    navigator,
    "userAgent"
  );

  const setMaxTouchPoints = (value: number): void => {
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value,
    });
  };

  const setUserAgent = (value: string): void => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value,
    });
  };

  afterEach(() => {
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

  it("returns true for an iPad reporting a desktop Mac user agent", () => {
    setMaxTouchPoints(5);
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15"
    );
    expect(isTouchPrimaryDevice()).toBe(true);
  });

  it("returns true for an Android tablet", () => {
    setMaxTouchPoints(0);
    setUserAgent(
      "Mozilla/5.0 (Linux; Android 15; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    );
    expect(isTouchPrimaryDevice()).toBe(true);
  });

  it("returns false for a desktop browser", () => {
    setMaxTouchPoints(0);
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15"
    );
    expect(isTouchPrimaryDevice()).toBe(false);
  });

  it("returns false for a Windows touchscreen laptop", () => {
    setMaxTouchPoints(10);
    setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    );
    expect(isTouchPrimaryDevice()).toBe(false);
  });
});

/**
 * `isScreenSharePickerDismissal` decides whether a rejected
 * `getDisplayMedia()` deserves an error toast. Safari rejects with
 * NotAllowedError both when the user dismisses the picker and when they
 * deny permission; neither should look like an app failure.
 */
describe("isScreenSharePickerDismissal", () => {
  it("treats NotAllowedError and AbortError as dismissals", () => {
    expect(
      isScreenSharePickerDismissal(
        new DOMException("denied", "NotAllowedError")
      )
    ).toBe(true);
    expect(
      isScreenSharePickerDismissal(new DOMException("aborted", "AbortError"))
    ).toBe(true);
  });

  it("does not treat real capture failures as dismissals", () => {
    expect(
      isScreenSharePickerDismissal(
        new DOMException("unsupported", "NotSupportedError")
      )
    ).toBe(false);
    expect(isScreenSharePickerDismissal(new Error("boom"))).toBe(false);
    expect(isScreenSharePickerDismissal(null)).toBe(false);
  });
});
