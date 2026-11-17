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
  enrichStudentProfiles: vi.fn(async (items: unknown[]) => items),
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

describe("GET /api/admin/students name fallback", () => {
  it("resolves a name that exists only in Clerk and re-runs with userIds", async () => {
    mockClerkClient.mockResolvedValue({
      users: {
        getUserList: vi.fn(async () => ({ data: [{ id: "user_clerk_name" }] })),
      },
    } as never);

    convexQuery
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 })
      .mockResolvedValueOnce({
        items: [{ userId: "user_clerk_name", email: null, firstName: "Ada", lastName: "Lovelace", sessionPacks: [] }],
        total: 1,
        page: 1,
        pageSize: 20,
      });

    const res = await GET(requestWithSearch("ada lovelace"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items.map((s: { userId: string }) => s.userId)).toEqual(["user_clerk_name"]);
    expect(convexQuery).toHaveBeenCalledTimes(2);
    expect(convexQuery.mock.calls[1][1]).toMatchObject({ userIds: ["user_clerk_name"] });
  });

  it("reads every Clerk page of name matches, not just the first 20", async () => {
    const firstPage = Array.from({ length: 100 }, (_, i) => ({ id: `user_page1_${i}` }));
    const secondPage = Array.from({ length: 3 }, (_, i) => ({ id: `user_page2_${i}` }));
    const getUserList = vi.fn(async ({ offset }: { offset: number }) => ({
      data: offset === 0 ? firstPage : secondPage,
    }));
    mockClerkClient.mockResolvedValue({ users: { getUserList } } as never);

    convexQuery
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });

    await GET(requestWithSearch("ada"));

    expect(getUserList).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }));
    expect(getUserList).toHaveBeenCalledWith(expect.objectContaining({ offset: 100 }));
    const forwarded = convexQuery.mock.calls[1][1] as { userIds: string[] };
    expect(forwarded.userIds).toHaveLength(103);
  });

  it("reports degraded when the name fallback fails instead of claiming no matches", async () => {
    mockClerkClient.mockResolvedValue({
      users: {
        getUserList: vi.fn(async () => {
          throw new Error("Clerk unavailable");
        }),
      },
    } as never);
    convexQuery.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

    const res = await GET(requestWithSearch("ada"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.degraded).toBe(true);
  }, 15000);

  it("does not consult Clerk for an email-shaped search", async () => {
    convexQuery.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    const getUserList = vi.fn(async () => ({ data: [] }));
    mockClerkClient.mockResolvedValue({ users: { getUserList } } as never);

    await GET(requestWithSearch("ada@example.com"));

    // The email fallback runs; the name fallback must not add a second shape.
    expect(getUserList).toHaveBeenCalledWith(
      expect.objectContaining({ emailAddress: ["ada@example.com"] })
    );
    expect(getUserList).not.toHaveBeenCalledWith(
      expect.objectContaining({ query: "ada@example.com" })
    );
  });
});
