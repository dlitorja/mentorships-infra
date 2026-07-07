import { describe, expect, it } from "vitest";
import { recordingDownloadFilename } from "./recording-filename";

describe("recordingDownloadFilename", () => {
  it("formats a valid callStartedAt as YYYY-MM-DD", () => {
    const result = recordingDownloadFilename(
      Date.UTC(2026, 6, 8, 14, 30, 0)
    );
    expect(result).toBe("mentorship-call-2026-07-08.mp4");
  });

  it("uses today's UTC date when callStartedAt is null", () => {
    const expected = `mentorship-call-${new Date()
      .toISOString()
      .slice(0, 10)}.mp4`;
    expect(recordingDownloadFilename(null)).toBe(expected);
  });

  it("uses today's UTC date when callStartedAt is undefined", () => {
    const expected = `mentorship-call-${new Date()
      .toISOString()
      .slice(0, 10)}.mp4`;
    expect(recordingDownloadFilename(undefined)).toBe(expected);
  });

  it("handles leap-day boundary correctly", () => {
    const result = recordingDownloadFilename(
      Date.UTC(2024, 1, 29, 23, 59, 59)
    );
    expect(result).toBe("mentorship-call-2024-02-29.mp4");
  });
});
