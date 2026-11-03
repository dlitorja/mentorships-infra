import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { makeRequest } from "tests/unit/api-route-utils";
import { getConvexClient } from "@/lib/convex";
import { clerkClient } from "@clerk/nextjs/server";

vi.mock("@/lib/auth-helpers", () => ({
  requireRoleForApi: vi.fn(async () => "admin"),
}));

vi.mock("@/lib/errors", () => ({
  isUnauthorizedError: (error: unknown) =>
    error instanceof Error && error.message.includes("Unauthorized"),
  isForbiddenError: (error: unknown) =>
    error instanceof Error && error.message.includes("Forbidden"),
}));

vi.mock("@/lib/convex", () => ({
  getConvexClient: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({
    getToken: vi.fn(async () => "convex-token"),
  })),
  clerkClient: vi.fn(),
}));

vi.mock("@/lib/admin/student-enrichment", () => ({
  enrichStudentEmails: vi.fn(async (items: unknown[]) => items),
}));

const convexQuery = vi.fn();
const mockGetConvexClient = vi.mocked(getConvexClient);
const mockClerkClient = vi.mocked(clerkClient);

function requestWithSearch(search: string) {
  const params = new URLSearchParams({ search });
  return makeRequest({ url: `http://localhost/api/admin/students?${params.toString()}` });
}

beforeEach(() => {
  vi.clearAllMocks();
  convexQuery.mockReset();
  mockGetConvexClient.mockReturnValue({
    setAuth: vi.fn(),
    query: convexQuery,
  } as never);
});

describe("GET /api/admin/students email fallback", () => {
  it("resolves an email that exists only in Clerk and re-runs with userIds", async () => {
    convexQuery
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 })
      .mockResolvedValueOnce({
        items: [
          {
            userId: "user_clerk_only",
            email: null,
            sessionPacks: [],
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });

    const getUserList = vi.fn(async () => ({
      data: [{ id: "user_clerk_only" }],
    }));
    mockClerkClient.mockResolvedValue({
      users: { getUserList },
    } as never);

    const response = await GET(requestWithSearch("jane@example.com"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].userId).toBe("user_clerk_only");
    expect(getUserList).toHaveBeenCalledWith({
      emailAddress: ["jane@example.com"],
      limit: 10,
    });
    expect(convexQuery).toHaveBeenCalledTimes(2);
    expect(convexQuery.mock.calls[1]?.[1]).toMatchObject({
      userIds: ["user_clerk_only"],
    });
    expect(convexQuery.mock.calls[1]?.[1]).not.toHaveProperty("search");
  });

  it("does not call Clerk when Convex already has a match", async () => {
    convexQuery.mockResolvedValueOnce({
      items: [{ userId: "user_convex", email: "jane@example.com", sessionPacks: [] }],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    const response = await GET(requestWithSearch("jane@example.com"));
    expect(response.status).toBe(200);
    expect(convexQuery).toHaveBeenCalledTimes(1);
    expect(mockClerkClient).not.toHaveBeenCalled();
  });

  it("does not call Clerk for an incomplete email search", async () => {
    convexQuery.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });

    const response = await GET(requestWithSearch("jane@"));
    expect(response.status).toBe(200);
    expect(convexQuery).toHaveBeenCalledTimes(1);
    expect(mockClerkClient).not.toHaveBeenCalled();
  });

  it("keeps the empty result when Clerk fails", async () => {
    convexQuery.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    mockClerkClient.mockRejectedValue(new Error("Clerk unavailable"));

    const response = await GET(requestWithSearch("jane@example.com"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toEqual([]);
    expect(convexQuery).toHaveBeenCalledTimes(1);
  });
});
