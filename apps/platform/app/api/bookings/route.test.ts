import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { makeRequest } from "tests/unit/api-route-utils";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { getGoogleCalendarClient } from "@/lib/google";
import { tasks } from "@trigger.dev/sdk";

vi.mock("@/lib/auth-helpers", () => ({
  requireAuth: vi.fn(() => "user_123"),
}));

vi.mock("@/lib/errors", () => ({
  isUnauthorizedError: (error: unknown) =>
    error instanceof Error && error.message.includes("Unauthorized"),
}));

vi.mock("@/lib/convex", () => ({
  getAuthenticatedConvexClient: vi.fn(),
}));

vi.mock("@/lib/google", () => ({
  getGoogleCalendarClient: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  decryptInstructorRefreshToken: vi.fn(() => "decrypted_token"),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(() => ({ userId: "clerk_user_123" })),
  clerkClient: vi.fn(() => ({
    users: {
      getUser: vi.fn(() => ({
        id: "clerk_user_123",
        emailAddresses: [{ id: "email_1", emailAddress: "student@example.com" }],
        primaryEmailAddressId: "email_1",
      })),
    },
  })),
}));

vi.mock("@trigger.dev/sdk", () => ({
  tasks: {
    trigger: vi.fn(),
  },
}));

vi.mock("@/lib/observability", () => ({
  reportError: vi.fn(),
}));

vi.mock("@/lib/utils", () => ({
  withRetries: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

const convexClient = {
  query: vi.fn(),
  mutation: vi.fn(),
};

const calendarClient = {
  events: {
    insert: vi.fn(),
    delete: vi.fn(),
  },
  freebusy: {
    query: vi.fn(),
  },
};

const mockGetAuthenticatedConvexClient = vi.mocked(getAuthenticatedConvexClient);
const mockGetGoogleCalendarClient = vi.mocked(getGoogleCalendarClient);
const mockTasksTrigger = vi.mocked(tasks.trigger);

const validBody = {
  instructorId: "instructor_1",
  start: "2026-08-10T10:00:00Z",
  end: "2026-08-10T11:00:00Z",
  timezone: "UTC",
  studentName: "Student Name",
};

const instructor = {
  _id: "instructor_1",
  name: "Instructor Name",
  email: "instructor@example.com",
  googleCalendarId: "primary",
  discordVoiceChannelUrl: "https://discord.gg/example",
};

const confirmedBooking = {
  _id: "booking_1",
  studentEmail: "student@example.com",
  studentName: "Student Name",
  startUtc: new Date(validBody.start).getTime(),
  endUtc: new Date(validBody.end).getTime(),
  status: "confirmed",
};

function makeBookingRequest(body: object = validBody) {
  return makeRequest({ method: "POST", url: "https://platform.test/api/bookings", body });
}

describe("POST /api/bookings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthenticatedConvexClient.mockResolvedValue(convexClient);
    mockGetGoogleCalendarClient.mockResolvedValue(calendarClient);
    convexClient.query.mockResolvedValue(instructor);
    convexClient.mutation.mockImplementation((api: any, args: any) => {
      if (args.instructorId) {
        return { bookingId: "booking_1" };
      }
      if (args.googleEventId) {
        return confirmedBooking;
      }
      return null;
    });
    calendarClient.freebusy.query.mockResolvedValue({
      data: { calendars: { primary: { busy: [] } } },
    });
    calendarClient.events.insert.mockResolvedValue({
      data: { id: "google_event_1" },
    });
    mockTasksTrigger.mockResolvedValue({ ok: true });
  });

  it("returns 401 when user is not authenticated", async () => {
    const { requireAuth } = await import("@/lib/auth-helpers");
    vi.mocked(requireAuth).mockRejectedValueOnce(new Error("Unauthorized"));

    const response = await POST(makeBookingRequest());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 400 when request body is invalid", async () => {
    const response = await POST(makeBookingRequest({ start: "not-a-date" }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Invalid request");
    expect(json.details).toBeDefined();
  });

  it("returns 400 when end time is before start time", async () => {
    const response = await POST(
      makeBookingRequest({
        ...validBody,
        start: "2026-08-10T12:00:00Z",
        end: "2026-08-10T10:00:00Z",
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid start/end" });
  });

  it("returns 404 when instructor is not found", async () => {
    convexClient.query.mockResolvedValueOnce(null);
    const response = await POST(makeBookingRequest());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Instructor not found" });
  });

  it("returns 409 when instructor calendar is not connected", async () => {
    const { decryptInstructorRefreshToken } = await import("@/lib/crypto");
    vi.mocked(decryptInstructorRefreshToken).mockReturnValueOnce(null);
    const response = await POST(makeBookingRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Instructor calendar not connected" });
  });

  it("returns 409 when slot is busy", async () => {
    calendarClient.freebusy.query.mockResolvedValueOnce({
      data: {
        calendars: {
          primary: {
            busy: [{ start: "2026-08-10T10:00:00Z", end: "2026-08-10T11:00:00Z" }],
          },
        },
      },
    });

    const response = await POST(makeBookingRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Slot no longer available" });
  });

  it("returns 409 when pending booking detects conflict", async () => {
    convexClient.mutation.mockImplementation((api: any, args: any) => {
      if (args.instructorId) {
        return { conflict: true };
      }
      if (args.googleEventId) {
        return confirmedBooking;
      }
      return null;
    });

    const response = await POST(makeBookingRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Slot already booked" });
  });

  it("creates booking and calendar event successfully", async () => {
    const response = await POST(makeBookingRequest());
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.booking).toBeDefined();
    expect(calendarClient.events.insert).toHaveBeenCalled();
    expect(mockTasksTrigger).toHaveBeenCalledWith("booking-notifications", expect.any(Object));
  });

  it("does not trigger notifications when suppressNotifications is true", async () => {
    const response = await POST(makeBookingRequest({ ...validBody, suppressNotifications: true }));
    expect(response.status).toBe(200);
    expect(mockTasksTrigger).not.toHaveBeenCalled();
  });

  it("returns 502 when Google Calendar event creation fails", async () => {
    calendarClient.events.insert.mockResolvedValueOnce({ data: { id: null } });
    const response = await POST(makeBookingRequest());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Failed to create calendar event" });
  });

  it("rolls back calendar event when confirm fails", async () => {
    convexClient.mutation.mockImplementation((api: any, args: any) => {
      if (args.instructorId) {
        return { bookingId: "booking_1" };
      }
      if (args.googleEventId) {
        throw new Error("Confirm failed");
      }
      if (args.id === "booking_1" && "status" in args) {
        return { ...confirmedBooking, status: args.status };
      }
      return null;
    });
    convexClient.query.mockImplementation((api: any, args: any) => {
      if (args.id === "booking_1") {
        return { ...confirmedBooking, status: "pending" };
      }
      return instructor;
    });

    const response = await POST(makeBookingRequest());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Failed to create calendar event or confirm booking" });
    expect(calendarClient.events.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "primary",
        eventId: "google_event_1",
      })
    );
  });
});
