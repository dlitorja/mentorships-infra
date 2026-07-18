import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { getDailyRecordingAccessLink, deleteDailyRecording, DailyApiError } from "./daily";

const originalFetch = globalThis.fetch;

describe("getDailyRecordingAccessLink", () => {
  beforeEach(() => {
    process.env.DAILY_API_KEY = "test-api-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns the presigned download URL on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ download_url: "https://download.example/signed" }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const url = await getDailyRecordingAccessLink("rec-123");
    expect(url).toBe("https://download.example/signed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://api.daily.co/v1/recordings/rec-123/access-link");
    expect(calledInit.method).toBe("GET");
  });

  it("returns null when Daily returns 404 (recording purged)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const url = await getDailyRecordingAccessLink("rec-deleted");
    expect(url).toBeNull();
  });

  it("throws DailyApiError on non-2xx non-404 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Server Error",
      json: async () => ({ error: "internal", info: "boom" }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(getDailyRecordingAccessLink("rec-500")).rejects.toBeInstanceOf(
      DailyApiError
    );
  });

  it("throws when the response is missing download_url", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ unexpected: "shape" }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(getDailyRecordingAccessLink("rec-123")).rejects.toBeInstanceOf(
      DailyApiError
    );
  });
});

describe("deleteDailyRecording", () => {
  beforeEach(() => {
    process.env.DAILY_API_KEY = "test-api-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns without throwing on 404 (idempotent)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(deleteDailyRecording("rec-already-purged")).resolves.toBeUndefined();
  });

  it("returns without throwing on 2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => ({}),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(deleteDailyRecording("rec-123")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://api.daily.co/v1/recordings/rec-123");
    expect(calledInit.method).toBe("DELETE");
  });

  it("throws DailyApiError on 500", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Server Error",
      json: async () => ({ error: "internal" }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(deleteDailyRecording("rec-500")).rejects.toBeInstanceOf(
      DailyApiError
    );
  });
});
