import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { makeRequest } from "tests/unit/api-route-utils";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { tasks } from "@trigger.dev/sdk";

vi.mock("@/lib/auth-helpers", () => ({
  requireRoleForApi: vi.fn(() => ({ id: "user_123", role: "instructor" })),
}));

vi.mock("@/lib/errors", () => ({
  isUnauthorizedError: (error: unknown) =>
    error instanceof Error && error.message.includes("Unauthorized"),
  isForbiddenError: (error: unknown) =>
    error instanceof Error && error.message.includes("Forbidden"),
}));

vi.mock("@/lib/convex", () => ({
  getAuthenticatedConvexClient: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  tasks: {
    trigger: vi.fn(),
  },
}));

const convexClient = {
  query: vi.fn(),
  mutation: vi.fn(),
};

const mockGetAuthenticatedConvexClient = vi.mocked(getAuthenticatedConvexClient);
const mockTasksTrigger = vi.mocked(tasks.trigger);

const session = {
  _id: "session_1",
  instructorId: "instructor_1",
  studentId: "student_1",
  scheduledAt: new Date("2026-08-10T10:00:00Z").getTime(),
};

const instructor = {
  _id: "instructor_1",
  name: "Instructor Name",
};

const studentUser = {
  email: "student@example.com",
  firstName: "Student",
  lastName: "Name",
  timeZone: "America/New_York",
};

const futureDate = new Date();
futureDate.setDate(futureDate.getDate() + 1);

function makeRescheduleRequest(body: object, sessionId: string = "session_1") {
  return {
    request: makeRequest({
      method: "POST",
      url: `https://platform.test/api/sessions/${sessionId}/reschedule`,
      body,
    }),
    params: Promise.resolve({ sessionId }),
  };
}

describe("POST /api/sessions/[sessionId]/reschedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedConvexClient.mockResolvedValue(convexClient);
    convexClient.query.mockImplementation((api: any, args: any) => {
      if (args.id === "session_1") return session;
      if (args.userId === "user_123") return instructor;
      if (args.userId === "student_1") return studentUser;
      return null;
    });
    convexClient.mutation.mockResolvedValue(null);
    mockTasksTrigger.mockResolvedValue({ ok: true });
  });

  it("returns 401 when not authenticated", async () => {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    vi.mocked(requireRoleForApi).mockRejectedValueOnce(new Error("Unauthorized"));

    const { request, params } = makeRescheduleRequest({ newScheduledAt: futureDate.toISOString() });
    const response = await POST(request, { params });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when instructor does not own the session", async () => {
    convexClient.query.mockImplementation((api: any, args: any) => {
      if (args.id === "session_1") return { ...session, instructorId: "other_instructor" };
      if (args.userId === "user_123") return instructor;
      return studentUser;
    });

    const { request, params } = makeRescheduleRequest({ newScheduledAt: futureDate.toISOString() });
    const response = await POST(request, { params });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it("returns 400 when newScheduledAt is missing", async () => {
    const { request, params } = makeRescheduleRequest({});
    const response = await POST(request, { params });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "newScheduledAt is required" });
  });

  it("returns 400 when newScheduledAt is not a valid date", async () => {
    const { request, params } = makeRescheduleRequest({ newScheduledAt: "invalid" });
    const response = await POST(request, { params });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid date format for newScheduledAt" });
  });

  it("returns 400 when newScheduledAt is in the past", async () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    const { request, params } = makeRescheduleRequest({ newScheduledAt: pastDate.toISOString() });
    const response = await POST(request, { params });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "newScheduledAt must be in the future" });
  });

  it("returns 404 when session is not found", async () => {
    convexClient.query.mockResolvedValueOnce(null);
    const { request, params } = makeRescheduleRequest({ newScheduledAt: futureDate.toISOString() }, "missing_session");
    const response = await POST(request, { params });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Session not found" });
  });

  it("reschedules session and triggers notification", async () => {
    const { request, params } = makeRescheduleRequest({ newScheduledAt: futureDate.toISOString() });
    const response = await POST(request, { params });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(convexClient.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: "session_1",
        newScheduledAt: futureDate.getTime(),
      })
    );
    expect(mockTasksTrigger).toHaveBeenCalledWith(
      "session-rescheduled-notifications",
      expect.objectContaining({
        sessionId: "session_1",
        studentEmail: "student@example.com",
      })
    );
  });

  it("skips notification when suppressNotifications is true", async () => {
    const { request, params } = makeRescheduleRequest({
      newScheduledAt: futureDate.toISOString(),
      suppressNotifications: true,
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(200);
    expect(mockTasksTrigger).not.toHaveBeenCalled();
  });
});
