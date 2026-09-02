import { beforeEach, describe, expect, it, vi } from "vitest";

const mockConvexServerCall = vi.fn();

vi.mock("../../../apps/platform/inngest/client", () => ({
  inngest: {
    createFunction: vi.fn((config, handler) => ({ ...config, handler })),
  },
}));

vi.mock("../../../apps/platform/lib/convex-server-call", () => ({
  convexServerCall: mockConvexServerCall,
}));

vi.mock("../../../apps/platform/lib/observability", () => ({
  reportInfo: vi.fn(),
  reportError: vi.fn(),
}));

const { handleClerkUserUpdated } = await import(
  "../../../apps/platform/inngest/functions/clerk-user-instructor-lifecycle"
);

describe("Clerk user profile synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConvexServerCall.mockResolvedValue({ updatedCount: 1 });
  });

  it("syncs an ordinary student profile update before returning no-op", async () => {
    const result = await (handleClerkUserUpdated as unknown as { handler: Function }).handler({
      event: {
        data: {
          userId: "user_student",
          email: "STUDENT@example.com",
          role: "student",
          firstName: "Updated",
          lastName: "Name",
        },
      },
      step: { run: async (_id: string, callback: () => Promise<unknown>) => callback() },
    });

    expect(mockConvexServerCall).toHaveBeenCalledWith("/users/sync-clerk-profile", {
      clerkUserId: "user_student",
      email: "student@example.com",
      firstName: "Updated",
      lastName: "Name",
    });
    expect(result).toMatchObject({ processed: true, action: "no-op" });
  });

  it("forwards cleared names as null", async () => {
    await (handleClerkUserUpdated as unknown as { handler: Function }).handler({
      event: {
        data: {
          userId: "user_student",
          email: "student@example.com",
          role: "student",
          firstName: null,
          lastName: null,
        },
      },
      step: { run: async (_id: string, callback: () => Promise<unknown>) => callback() },
    });

    expect(mockConvexServerCall).toHaveBeenCalledWith(
      "/users/sync-clerk-profile",
      expect.objectContaining({ firstName: null, lastName: null })
    );
  });
});
