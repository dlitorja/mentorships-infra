import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest } from "tests/unit/api-route-utils";

const mockVerifyWebhook = vi.fn();
const mockSend = vi.fn();

vi.mock("@clerk/nextjs/webhooks", () => ({
  verifyWebhook: mockVerifyWebhook,
}));

vi.mock("@/inngest/client", () => ({
  inngest: { send: mockSend },
}));

vi.mock("@/lib/convex-server-call", () => ({
  convexServerCall: vi.fn(),
}));

const { POST } = await import("./route");

describe("Clerk webhook profile updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = "test-signing-secret";
    mockSend.mockResolvedValue(undefined);
  });

  it("forwards the primary email and nullable names", async () => {
    mockVerifyWebhook.mockResolvedValue({
      type: "user.updated",
      data: {
        id: "user_student",
        primary_email_address_id: "email_primary",
        email_addresses: [
          { id: "email_secondary", email_address: "secondary@example.com" },
          { id: "email_primary", email_address: "primary@example.com" },
        ],
        public_metadata: { role: "student" },
        first_name: null,
        last_name: "Student",
      },
    });

    const response = await POST(
      makeRequest({ method: "POST", url: "https://platform.test/api/webhooks/clerk" })
    );

    expect(response.status).toBe(200);
    expect(mockSend).toHaveBeenCalledWith({
      name: "clerk/user.updated",
      data: {
        userId: "user_student",
        email: "primary@example.com",
        role: "student",
        firstName: null,
        lastName: "Student",
        previousRole: undefined,
      },
    });
  });
});
