import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "./route";
import { makeRequest } from "tests/unit/api-route-utils";

vi.mock("@/lib/auth-helpers", () => ({
  requireRoleForApi: vi.fn(async () => ({ id: "user_instructor", role: "instructor" })),
  getConvexAuthToken: vi.fn(async () => "convex-token"),
}));

vi.mock("@/lib/errors", () => ({
  isUnauthorizedError: (error: unknown) =>
    error instanceof Error && error.message.includes("Unauthorized"),
  isForbiddenError: (error: unknown) =>
    error instanceof Error && error.message.includes("Forbidden"),
}));

const convexClient = {
  setAuth: vi.fn(),
  query: vi.fn(),
  mutation: vi.fn(),
};

vi.mock("@/lib/convex", () => ({
  getConvexClient: vi.fn(() => convexClient),
}));

const SESSION_PACK_ID = "k97cfnv3bh7ech6c4jm4pjchyh8d547r";

const instructor = { _id: "instructor_1" };

/**
 * A pack stored by the pre-fix `admin.incrementRemainingSessions`: the
 * balance was raised without growing the pack, so the row carries more
 * credits than its recorded size. The platform dialog repairs it by
 * lowering the count, and the stored (expected) snapshot is the only
 * baseline available — the request must not be rejected for mirroring it.
 */
const overCapacityPack = {
  _id: SESSION_PACK_ID,
  userId: "user_student",
  instructorId: "instructor_1",
  totalSessions: 4,
  remainingSessions: 5,
  status: "active",
};

const updatedPack = {
  ...overCapacityPack,
  remainingSessions: 4,
};

async function patch(body: unknown) {
  return await PATCH(
    makeRequest({
      method: "PATCH",
      url: `http://localhost/api/instructor/session-packs/${SESSION_PACK_ID}`,
      body: body as object,
    }),
    { params: Promise.resolve({ sessionPackId: SESSION_PACK_ID }) },
  );
}

describe("PATCH /api/instructor/session-packs/[sessionPackId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    convexClient.query.mockResolvedValueOnce(instructor).mockResolvedValueOnce(overCapacityPack);
    convexClient.mutation.mockResolvedValue(updatedPack);
  });

  it("accepts an over-capacity expected snapshot so the instructor can repair the count", async () => {
    const res = await patch({
      action: "setBoth",
      totalSessions: 4,
      remainingSessions: 4,
      expectedTotalSessions: 4,
      // The stored counts — legally over capacity. This pair is only the
      // optimistic-concurrency baseline, not the requested state.
      expectedRemainingSessions: 5,
    });

    expect(res.status).toBe(200);
    expect(convexClient.mutation).toHaveBeenCalledTimes(1);
    expect(convexClient.mutation.mock.calls[0][1]).toMatchObject({
      id: SESSION_PACK_ID,
      totalSessions: 4,
      remainingSessions: 4,
      expectedTotalSessions: 4,
      expectedRemainingSessions: 5,
    });
    const JSON_BODY = await res.json();
    expect(JSON_BODY.sessionPack.remainingSessions).toBe(4);
  });

  it("accepts an over-capacity expected snapshot for restore as well", async () => {
    const res = await patch({
      action: "restore",
      totalSessions: 4,
      remainingSessions: 4,
      expectedTotalSessions: 4,
      expectedRemainingSessions: 5,
    });

    expect(res.status).toBe(200);
    expect(convexClient.mutation).toHaveBeenCalledTimes(1);
  });

  it("still rejects a requested state whose remaining exceeds the pack size", async () => {
    const res = await patch({
      action: "setBoth",
      totalSessions: 4,
      remainingSessions: 6,
      expectedTotalSessions: 4,
      expectedRemainingSessions: 5,
    });

    expect(res.status).toBe(400);
    expect(convexClient.mutation).not.toHaveBeenCalled();
  });

  it("still rejects an instructor attempt to change the total", async () => {
    const res = await patch({
      action: "setBoth",
      totalSessions: 9,
      remainingSessions: 4,
      expectedTotalSessions: 4,
      expectedRemainingSessions: 5,
    });

    expect(res.status).toBe(403);
    expect(convexClient.mutation).not.toHaveBeenCalled();
  });
});
