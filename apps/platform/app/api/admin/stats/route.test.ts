import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/convex", () => ({
  getAuthenticatedConvexClient: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireRoleForApi: vi.fn(async () => undefined),
}));

import { getAuthenticatedConvexClient } from "@/lib/convex";

const mockGetClient = vi.mocked(getAuthenticatedConvexClient);

/**
 * The dashboard used to read `totalActiveMentees` / `hasMenteeData`, which the
 * client never consumed (`totalActiveStudents` / `hasStudentData`), so every
 * card rendered "No students yet" / $0.00 no matter what the business did.
 */
describe("GET /api/admin/stats", () => {
  const query = vi.fn();

  beforeEach(() => {
    query.mockReset();
    mockGetClient.mockReset();
    mockGetClient.mockResolvedValue({ query } as never);
  });

  it("passes through the real stats with the field names the client reads", async () => {
    const payload = {
      totalActiveStudents: 12,
      revenueThisMonth: 3750.5,
      revenueLastMonth: 3000,
      revenueChange: 25,
      revenueThisYear: 41250,
      hasRevenueData: true,
      hasStudentData: true,
      hasHistoricalRevenue: true,
    };
    query.mockResolvedValue(payload);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(payload);
    expect(body).not.toHaveProperty("totalActiveMentees");
    expect(body).not.toHaveProperty("hasMenteeData");
  });

  it("reports an honest empty state rather than inventing activity", async () => {
    query.mockResolvedValue({
      totalActiveStudents: 0,
      revenueThisMonth: 0,
      revenueLastMonth: 0,
      revenueChange: 0,
      revenueThisYear: 0,
      hasRevenueData: false,
      hasStudentData: false,
      hasHistoricalRevenue: false,
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.hasStudentData).toBe(false);
    expect(body.totalActiveStudents).toBe(0);
  });

  it("500s when the query fails instead of serving fake zeros", async () => {
    query.mockRejectedValue(new Error("Convex unavailable"));

    const res = await GET();

    expect(res.status).toBe(500);
  });
});
