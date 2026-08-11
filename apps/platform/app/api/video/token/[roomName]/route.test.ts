import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { createMeetingToken, DailyApiError } from "@/lib/daily";
import { makeRequest } from "tests/unit/api-route-utils";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("convex/nextjs", () => ({
  fetchQuery: vi.fn(),
}));

vi.mock("@/lib/daily", () => ({
  createMeetingToken: vi.fn(),
  DailyApiError: class extends Error {
    statusCode: number;
    errorType: string | undefined;
    info: string | undefined;
    constructor(params: {
      statusCode: number;
      message: string;
      errorType?: string;
      info?: string;
    }) {
      super(params.message);
      this.statusCode = params.statusCode;
      this.errorType = params.errorType;
      this.info = params.info;
    }
  },
  DAILY_MAX_RECORDING_SECONDS: 4 * 60 * 60,
}));

vi.mock("@/lib/observability", () => ({
  reportError: vi.fn(),
}));

const { auth } = await import("@clerk/nextjs/server");
const { fetchQuery } = await import("convex/nextjs");

const mockAuth = vi.mocked(auth);
const mockFetchQuery = vi.mocked(fetchQuery);
const mockCreateMeetingToken = vi.mocked(createMeetingToken);

// Build a typed Clerk auth object for tests. We only need a few fields,
// so we cast a partial fixture at this single boundary instead of sprinkling
// `as unknown as` throughout the test.
function authFixture(value: Partial<Awaited<ReturnType<typeof auth>>>) {
  return value as Awaited<ReturnType<typeof auth>>;
}

function tokenRequest(roomName: string): ReturnType<typeof makeRequest> {
  return makeRequest({
    method: "GET",
    url: `https://platform.test/api/video/token/${roomName}`,
  });
}

function mockSession({
  role,
  recordingConsent,
  roomRecordingEnabled,
}: {
  role: "owner" | "student";
  recordingConsent: boolean;
  roomRecordingEnabled: boolean | null | undefined;
}): void {
  mockFetchQuery.mockResolvedValue({
    role,
    recordingConsent,
    roomRecordingEnabled,
  });
}

function mockAuthenticatedAuth(): void {
  mockAuth.mockResolvedValue(
    authFixture({
      userId: "clerk_user_123",
      getToken: vi.fn().mockResolvedValue("convex-token"),
      sessionClaims: {
        firstName: "Test",
        lastName: "User",
      },
    })
  );
}

function mockUnauthenticatedAuth(): void {
  mockAuth.mockResolvedValue(
    authFixture({
      userId: null,
    })
  );
}

describe("GET /api/video/token/[roomName]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticatedAuth();
    mockCreateMeetingToken.mockResolvedValue({ token: "meeting-jwt" });
  });

  it("returns 401 when the user is not authenticated", async () => {
    mockUnauthenticatedAuth();

    const response = await GET(tokenRequest("room-1"), {
      params: Promise.resolve({ roomName: "room-1" }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mockCreateMeetingToken).not.toHaveBeenCalled();
  });

  it("returns 401 when the Convex token cannot be obtained", async () => {
    mockAuth.mockResolvedValue(
      authFixture({
        userId: "clerk_user_123",
        getToken: vi.fn().mockResolvedValue(null),
      })
    );

    const response = await GET(tokenRequest("room-1"), {
      params: Promise.resolve({ roomName: "room-1" }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Failed to acquire auth token",
    });
    expect(mockCreateMeetingToken).not.toHaveBeenCalled();
  });

  it("returns 400 when roomName is missing", async () => {
    const response = await GET(tokenRequest(""), {
      params: Promise.resolve({ roomName: "" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Missing roomName" });
    expect(mockCreateMeetingToken).not.toHaveBeenCalled();
  });

  it("returns 403 when the session is not found", async () => {
    mockFetchQuery.mockResolvedValue(null);

    const response = await GET(tokenRequest("room-1"), {
      params: Promise.resolve({ roomName: "room-1" }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(mockCreateMeetingToken).not.toHaveBeenCalled();
  });

  it("requests auto-recording for the owner when consent and room recording are enabled", async () => {
    mockSession({
      role: "owner",
      recordingConsent: true,
      roomRecordingEnabled: true,
    });

    const response = await GET(tokenRequest("room-1"), {
      params: Promise.resolve({ roomName: "room-1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ token: "meeting-jwt" });
    expect(mockCreateMeetingToken).toHaveBeenCalledWith(
      expect.objectContaining({
        roomName: "room-1",
        userId: "clerk_user_123",
        userName: "Test User",
        isOwner: true,
        startCloudRecording: true,
      })
    );
  });

  it("does not request auto-recording for the owner when room recording is disabled", async () => {
    mockSession({
      role: "owner",
      recordingConsent: true,
      roomRecordingEnabled: false,
    });

    await GET(tokenRequest("room-1"), {
      params: Promise.resolve({ roomName: "room-1" }),
    });

    expect(mockCreateMeetingToken).toHaveBeenCalledWith(
      expect.objectContaining({
        isOwner: true,
        startCloudRecording: false,
      })
    );
  });

  it("does not request auto-recording for the owner when consent is false", async () => {
    mockSession({
      role: "owner",
      recordingConsent: false,
      roomRecordingEnabled: true,
    });

    await GET(tokenRequest("room-1"), {
      params: Promise.resolve({ roomName: "room-1" }),
    });

    expect(mockCreateMeetingToken).toHaveBeenCalledWith(
      expect.objectContaining({
        isOwner: true,
        startCloudRecording: false,
      })
    );
  });

  it("does not request auto-recording for a legacy session without a room recording snapshot", async () => {
    mockSession({
      role: "owner",
      recordingConsent: true,
      roomRecordingEnabled: undefined,
    });

    await GET(tokenRequest("room-1"), {
      params: Promise.resolve({ roomName: "room-1" }),
    });

    expect(mockCreateMeetingToken).toHaveBeenCalledWith(
      expect.objectContaining({
        isOwner: true,
        startCloudRecording: false,
      })
    );
  });

  it("does not request auto-recording when room recording is explicitly null", async () => {
    mockSession({
      role: "owner",
      recordingConsent: true,
      roomRecordingEnabled: null,
    });

    await GET(tokenRequest("room-1"), {
      params: Promise.resolve({ roomName: "room-1" }),
    });

    expect(mockCreateMeetingToken).toHaveBeenCalledWith(
      expect.objectContaining({
        isOwner: true,
        startCloudRecording: false,
      })
    );
  });

  it("does not request auto-recording for a student participant", async () => {
    mockSession({
      role: "student",
      recordingConsent: true,
      roomRecordingEnabled: true,
    });

    await GET(tokenRequest("room-1"), {
      params: Promise.resolve({ roomName: "room-1" }),
    });

    expect(mockCreateMeetingToken).toHaveBeenCalledWith(
      expect.objectContaining({
        isOwner: false,
        startCloudRecording: false,
      })
    );
  });

  it("returns 502 when DailyApiError is thrown", async () => {
    mockSession({
      role: "owner",
      recordingConsent: true,
      roomRecordingEnabled: true,
    });
    mockCreateMeetingToken.mockRejectedValue(
      new DailyApiError({
        statusCode: 500,
        message: "Daily API 500: boom",
      })
    );

    const response = await GET(tokenRequest("room-1"), {
      params: Promise.resolve({ roomName: "room-1" }),
    });

    expect(response.status).toBe(502);
    const json = await response.json();
    expect(json.error).toBe("Failed to create meeting token");
  });
});
