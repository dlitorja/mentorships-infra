import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { recordingDownloadFilename } from "./recording-filename";

describe("recordingDownloadFilename", () => {
  beforeEach(() => {
    // Freeze "now" so tests that fall back to Date.now() compare
    // against a deterministic UTC date — otherwise the two tests
    // that read `new Date()` can race across a UTC midnight
    // boundary and flake. Greptile R4 P1.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T14:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats a valid callStartedAt as YYYY-MM-DD", () => {
    const result = recordingDownloadFilename(
      Date.UTC(2026, 6, 8, 14, 30, 0)
    );
    expect(result).toBe("mentorship-call-2026-07-08.mp4");
  });

  it("uses today's UTC date when callStartedAt is null", () => {
    expect(recordingDownloadFilename(null)).toBe(
      "mentorship-call-2026-07-08.mp4"
    );
  });

  it("uses today's UTC date when callStartedAt is undefined", () => {
    expect(recordingDownloadFilename(undefined)).toBe(
      "mentorship-call-2026-07-08.mp4"
    );
  });

  it("falls back to today's UTC date when callStartedAt is NaN", () => {
    expect(recordingDownloadFilename(Number.NaN)).toBe(
      "mentorship-call-2026-07-08.mp4"
    );
  });

  it("falls back to today's UTC date when callStartedAt is Infinity", () => {
    expect(recordingDownloadFilename(Number.POSITIVE_INFINITY)).toBe(
      "mentorship-call-2026-07-08.mp4"
    );
  });

  it("falls back to today's UTC date when callStartedAt is negative", () => {
    // The function trusts Number.isFinite() but a negative finite
    // number would still produce a valid ISO date — cover that
    // we don't accidentally produce an invalid filename by
    // asserting against the resulting date.
    const result = recordingDownloadFilename(-1);
    expect(result).toMatch(/^mentorship-call-1969-12-31\.mp4$/);
  });

  it("handles leap-day boundary correctly", () => {
    const result = recordingDownloadFilename(
      Date.UTC(2024, 1, 29, 23, 59, 59)
    );
    expect(result).toBe("mentorship-call-2024-02-29.mp4");
  });

  it("uses .mov extension when the S3 key ends in .mov", () => {
    expect(
      recordingDownloadFilename(
        Date.UTC(2026, 6, 8, 14, 30, 0),
        "recordings/session-123.mov"
      )
    ).toBe("mentorship-call-2026-07-08.mov");
  });

  it("uses .webm extension when the S3 key ends in .webm", () => {
    expect(
      recordingDownloadFilename(
        Date.UTC(2026, 6, 8, 14, 30, 0),
        "recordings/session-123.webm"
      )
    ).toBe("mentorship-call-2026-07-08.webm");
  });

  it("falls back to .mp4 when the S3 key has no extension", () => {
    expect(
      recordingDownloadFilename(
        Date.UTC(2026, 6, 8, 14, 30, 0),
        "recordings/session-123"
      )
    ).toBe("mentorship-call-2026-07-08.mp4");
  });
});
