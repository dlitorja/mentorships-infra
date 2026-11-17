import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { makeRequest } from "tests/unit/api-route-utils";

vi.mock("@/lib/convex", () => ({
  getAuthenticatedConvexClient: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireRoleForApi: vi.fn(async () => undefined),
}));

import { getAuthenticatedConvexClient } from "@/lib/convex";

const mockGetClient = vi.mocked(getAuthenticatedConvexClient);

/**
 * The status filter used to be silently dropped: the page sent `status`, this
 * route's Zod schema accepted only `page`/`pageSize`, and Zod strips unknown
 * keys. Selecting "Refunded" returned the unfiltered list paginated as if
 * filtered. `search` had the same fate, with the page filtering client-side
 * over whichever 20 rows it had loaded.
 */
describe("GET /api/admin/orders", () => {
  const query = vi.fn();

  beforeEach(() => {
    query.mockReset();
    mockGetClient.mockReset();
    mockGetClient.mockResolvedValue({ query } as never);
    query.mockResolvedValue({ items: [], total: 0, hasMore: false });
  });

  it("forwards status and search to the query, filtered before pagination", async () => {
    const res = await GET(
      makeRequest({
        url: "http://localhost/api/admin/orders?page=2&pageSize=20&status=refunded&search=alice%40example.com",
      })
    );

    expect(res.status).toBe(200);
    expect(query).toHaveBeenCalledWith(expect.anything(), {
      limit: 20,
      offset: 20,
      status: "refunded",
      search: "alice@example.com",
    });
  });

  it("rejects an unknown status instead of silently ignoring it", async () => {
    const res = await GET(
      makeRequest({ url: "http://localhost/api/admin/orders?status=refundd" })
    );

    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("leaves filters undefined when absent", async () => {
    await GET(makeRequest({ url: "http://localhost/api/admin/orders" }));

    expect(query).toHaveBeenCalledWith(expect.anything(), {
      limit: 20,
      offset: 0,
      status: undefined,
      search: undefined,
    });
  });
});
