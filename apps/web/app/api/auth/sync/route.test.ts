import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { makeRequest } from "tests/unit/api-route-utils";

const mockConvexMutation = vi.fn();
const mockSetAuth = vi.fn();
const mockGetToken = vi.fn();
const mockGetUser = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(() => ({
    userId: "clerk_user_123",
    getToken: mockGetToken,
  })),
  clerkClient: vi.fn(() => ({
    users: { getUser: mockGetUser },
  })),
}));

vi.mock("@/lib/convex", () => ({
  getConvexClient: vi.fn(() => ({
    mutation: mockConvexMutation,
    setAuth: mockSetAuth,
  })),
}));

describe("GET /api/auth/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetToken.mockResolvedValue("convex_token");
    mockGetUser.mockResolvedValue({
      id: "clerk_user_123",
      publicMetadata: { role: "student" },
    });
    mockConvexMutation.mockResolvedValue({
      _id: "user_123",
      email: "test@example.com",
      role: "student",
    });
  });

  it("returns 401 when no clerk user", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: null,
      getToken: mockGetToken,
    });

    const response = await GET();
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when convex token cannot be generated", async () => {
    mockGetToken.mockResolvedValueOnce(null);
    const response = await GET();
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json).toEqual({ error: "Unauthorized" });
  });

  it("syncs user and returns user data", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({
      success: true,
      user: {
        id: "user_123",
        email: "test@example.com",
        role: "student",
      },
    });
    expect(mockSetAuth).toHaveBeenCalledWith("convex_token");
    expect(mockConvexMutation).toHaveBeenCalledWith(expect.anything(), { role: "student" });
  });

  it("handles missing role metadata", async () => {
    mockGetUser.mockResolvedValueOnce({
      id: "clerk_user_123",
      publicMetadata: {},
    });

    const response = await GET();
    expect(response.status).toBe(200);
    expect(mockConvexMutation).toHaveBeenCalledWith(expect.anything(), { role: undefined });
  });

  it("returns 500 when sync mutation fails", async () => {
    mockConvexMutation.mockResolvedValueOnce(null);
    const response = await GET();
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toEqual({ error: "Failed to sync user" });
  });

  it("returns 500 on unexpected errors", async () => {
    mockGetUser.mockRejectedValueOnce(new Error("Clerk unavailable"));
    const response = await GET();
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toEqual({ error: "Failed to sync user" });
  });
});
