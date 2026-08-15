import { describe, expect, it, beforeEach, vi, afterEach, type MockInstance } from "vitest";
import {
  getDailyRecordingAccessLink,
  deleteDailyRecording,
  createMeetingToken,
  DailyApiError,
} from "./daily";

const originalFetch = globalThis.fetch;

function mockFetchWithResponse(response: Response): MockInstance<typeof globalThis.fetch> {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("getDailyRecordingAccessLink", () => {
  beforeEach(() => {
    process.env.DAILY_API_KEY = "test-api-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns the presigned download URL on success", async () => {
    const fetchSpy = mockFetchWithResponse(
      jsonResponse({ download_url: "https://download.example/signed" })
    );

    const url = await getDailyRecordingAccessLink("rec-123");
    expect(url).toBe("https://download.example/signed");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("https://api.daily.co/v1/recordings/rec-123/access-link");
    expect(calledInit?.method).toBe("GET");
  });

  it("returns null when Daily returns 404 (recording purged)", async () => {
    const fetchSpy = mockFetchWithResponse(
      jsonResponse({}, { status: 404, statusText: "Not Found" })
    );

    const url = await getDailyRecordingAccessLink("rec-deleted");
    expect(url).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws DailyApiError on non-2xx non-404 response", async () => {
    mockFetchWithResponse(
      jsonResponse(
        { error: "internal", info: "boom" },
        { status: 500, statusText: "Server Error" }
      )
    );

    await expect(getDailyRecordingAccessLink("rec-500")).rejects.toBeInstanceOf(
      DailyApiError
    );
  });

  it("throws when the response is missing download_url", async () => {
    mockFetchWithResponse(jsonResponse({ unexpected: "shape" }));

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
    mockFetchWithResponse(
      jsonResponse({}, { status: 404, statusText: "Not Found" })
    );

    await expect(deleteDailyRecording("rec-already-purged")).resolves.toBeUndefined();
  });

  it("returns without throwing on 2xx", async () => {
    const fetchSpy = mockFetchWithResponse(new Response(null, { status: 204 }));

    await expect(deleteDailyRecording("rec-123")).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("https://api.daily.co/v1/recordings/rec-123");
    expect(calledInit?.method).toBe("DELETE");
  });

  it("throws DailyApiError on 500", async () => {
    mockFetchWithResponse(
      jsonResponse({ error: "internal" }, { status: 500, statusText: "Server Error" })
    );

    await expect(deleteDailyRecording("rec-500")).rejects.toBeInstanceOf(
      DailyApiError
    );
  });
});

describe("createMeetingToken", () => {
  beforeEach(() => {
    process.env.DAILY_API_KEY = "test-api-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("includes start_cloud_recording and enable_screenshare when owner", async () => {
    const fetchSpy = mockFetchWithResponse(jsonResponse({ token: "jwt-token" }));

    const result = await createMeetingToken({
      roomName: "room-1",
      userId: "user-1",
      userName: "Instructor",
      isOwner: true,
      ttlSeconds: 3600,
      startCloudRecording: true,
    });

    expect(result.token).toBe("jwt-token");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, calledInit] = fetchSpy.mock.calls[0];
    expect(calledInit).toBeDefined();
    const body = JSON.parse(calledInit.body as string);
    expect(body.properties.start_cloud_recording).toBe(true);
    expect(body.properties.is_owner).toBe(true);
    expect(body.properties.enable_screenshare).toBe(true);
  });

  it("omits start_cloud_recording but keeps enable_screenshare for non-owner", async () => {
    const fetchSpy = mockFetchWithResponse(jsonResponse({ token: "jwt-token" }));

    await createMeetingToken({
      roomName: "room-1",
      userId: "user-2",
      userName: "Student",
      isOwner: false,
      ttlSeconds: 3600,
      startCloudRecording: false,
    });

    const [, calledInit] = fetchSpy.mock.calls[0];
    expect(calledInit).toBeDefined();
    const body = JSON.parse(calledInit.body as string);
    expect(body.properties).not.toHaveProperty("start_cloud_recording");
    expect(body.properties.is_owner).toBe(false);
    expect(body.properties.enable_screenshare).toBe(true);
  });

  it("throws DailyApiError when token is missing from the response", async () => {
    mockFetchWithResponse(jsonResponse({}));

    await expect(
      createMeetingToken({
        roomName: "room-1",
        userId: "user-1",
        userName: "Instructor",
        isOwner: true,
        ttlSeconds: 3600,
      })
    ).rejects.toBeInstanceOf(DailyApiError);
  });
});
