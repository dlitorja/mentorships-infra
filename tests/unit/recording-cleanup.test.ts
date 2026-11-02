import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRecordingCleanup } from "../../src/trigger/lib/recording-cleanup";

function setup() {
  const headFile = vi.fn();
  const deleteDailyRecording = vi.fn();
  const notify = vi.fn().mockResolvedValue(undefined);
  const sleep = vi.fn().mockResolvedValue(undefined);
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const cleanup = createRecordingCleanup({
    headFile,
    deleteDailyRecording,
    notify,
    log,
    sleep,
  });
  return { ...cleanup, headFile, deleteDailyRecording, notify, sleep, log };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("verifyB2Recording", () => {
  it("passes when the object exists with the expected size", async () => {
    const { verifyB2Recording, headFile } = setup();
    headFile.mockResolvedValue({ key: "recordings/a.mp4", size: 100, etag: "e" });

    await expect(
      verifyB2Recording({ b2Key: "recordings/a.mp4", expectedBytes: 100 })
    ).resolves.toEqual({ bytes: 100, etag: "e" });
  });

  it("throws when the object is missing", async () => {
    const { verifyB2Recording, headFile } = setup();
    headFile.mockResolvedValue(null);

    await expect(
      verifyB2Recording({ b2Key: "recordings/missing.mp4" })
    ).rejects.toThrow(/not found/);
  });

  it("throws when the object is empty", async () => {
    const { verifyB2Recording, headFile } = setup();
    headFile.mockResolvedValue({ key: "recordings/empty.mp4", size: 0 });

    await expect(
      verifyB2Recording({ b2Key: "recordings/empty.mp4" })
    ).rejects.toThrow(/empty/);
  });

  it("throws when the size does not match the streamed bytes", async () => {
    const { verifyB2Recording, headFile } = setup();
    headFile.mockResolvedValue({ key: "recordings/short.mp4", size: 99 });

    await expect(
      verifyB2Recording({
        b2Key: "recordings/short.mp4",
        expectedBytes: 100,
      })
    ).rejects.toThrow(/99 bytes, expected 100/);
  });
});

describe("attemptDailyCleanup", () => {
  it("marks cleanup done on the first successful delete", async () => {
    const { attemptDailyCleanup, deleteDailyRecording, notify, sleep } = setup();
    deleteDailyRecording.mockResolvedValue(undefined);

    const result = await attemptDailyCleanup({
      sessionId: "session_1",
      recordingId: "rec_1",
    });

    expect(result).toEqual({ status: "done", attempts: 1 });
    expect(sleep).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("mark-daily-cleanup-done", {
      sessionId: "session_1",
    });
  });

  it("retries with backoff and then succeeds", async () => {
    const {
      attemptDailyCleanup,
      deleteDailyRecording,
      notify,
      sleep,
    } = setup();
    deleteDailyRecording
      .mockRejectedValueOnce(new Error("500"))
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce(undefined);

    const result = await attemptDailyCleanup({
      sessionId: "session_2",
      recordingId: "rec_2",
    });

    expect(result).toEqual({ status: "done", attempts: 3 });
    expect(sleep.mock.calls).toEqual([[2_000], [5_000]]);
    expect(notify).toHaveBeenCalledWith("mark-daily-cleanup-done", {
      sessionId: "session_2",
    });
  });

  it("marks cleanup failed after exhausting retries", async () => {
    const {
      attemptDailyCleanup,
      deleteDailyRecording,
      notify,
      sleep,
    } = setup();
    deleteDailyRecording.mockRejectedValue(new Error("Daily API 500"));

    const result = await attemptDailyCleanup({
      sessionId: "session_3",
      recordingId: "rec_3",
    });

    expect(result).toEqual({
      status: "failed",
      attempts: 3,
      error: "Daily API 500",
    });
    expect(sleep.mock.calls).toEqual([[2_000], [5_000]]);
    expect(notify).toHaveBeenCalledWith("mark-daily-cleanup-failed", {
      sessionId: "session_3",
      errorMessage: "Daily API 500",
    });
  });

  it("does not throw when the failed callback also fails", async () => {
    const { attemptDailyCleanup, deleteDailyRecording, notify, log } = setup();
    deleteDailyRecording.mockRejectedValue(new Error("Daily API 500"));
    notify.mockImplementation((path: string) =>
      path === "mark-daily-cleanup-failed"
        ? Promise.reject(new Error("callback down"))
        : Promise.resolve(undefined)
    );

    const result = await attemptDailyCleanup({
      sessionId: "session_5",
      recordingId: "rec_5",
    });

    expect(result).toEqual({
      status: "failed",
      attempts: 3,
      error: "Daily API 500",
    });
    expect(log.error).toHaveBeenCalled();
  });

  it("does not fail the recording when the done callback fails", async () => {
    const { attemptDailyCleanup, deleteDailyRecording, notify, log } = setup();
    deleteDailyRecording.mockResolvedValue(undefined);
    notify.mockRejectedValue(new Error("callback down"));

    const result = await attemptDailyCleanup({
      sessionId: "session_4",
      recordingId: "rec_4",
    });

    expect(result).toEqual({ status: "done", attempts: 1 });
    expect(log.warn).toHaveBeenCalled();
  });
});
