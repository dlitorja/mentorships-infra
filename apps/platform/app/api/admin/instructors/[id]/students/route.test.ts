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

const INSTRUCTOR_ID = "jd7f0j2m5n8q1s4v7y0b3c6x9z";

function makeContext(id = INSTRUCTOR_ID) {
  return { params: Promise.resolve({ id }) };
}

function makeGet() {
  return GET(makeRequest({ url: `http://localhost/api/admin/instructors/${INSTRUCTOR_ID}/students` }), makeContext());
}

/**
 * A realistic `admin.getInstructorWithStudents` payload. This is the contract
 * the route validates against: the previous implementation validated a *flat*
 * student shape against `getStudentsForAdmin`'s grouped response, so it 500ed
 * for every real request.
 */
const enrolmentRow = {
  userId: "user_student_1",
  email: "student@example.com",
  sessionPackId: "k17f0j2m5n8q1s4v7y0b3c6x",
  totalSessions: 4,
  remainingSessions: 2,
  status: "active" as const,
  expiresAt: Date.UTC(2026, 5, 1),
  lastSessionCompletedAt: Date.UTC(2026, 0, 9),
  completedSessionCount: 2,
  seatStatus: "active" as const,
  seatExpiresAt: Date.UTC(2026, 6, 1),
};

const instructorPayload = {
  instructorId: INSTRUCTOR_ID,
  userId: "user_instructor_1",
  email: "instructor@example.com",
  bio: null,
  oneOnOneInventory: 3,
  groupInventory: 2,
  maxActiveStudents: 10,
  activeStudentCount: 1,
  createdAt: Date.UTC(2025, 0, 1),
  students: [enrolmentRow],
};

describe("GET /api/admin/instructors/[id]/students", () => {
  const query = vi.fn();

  beforeEach(() => {
    query.mockReset();
    mockGetClient.mockReset();
    mockGetClient.mockResolvedValue({ query } as never);
  });

  it("returns the instructor's enrolments and the canonical active count", async () => {
    query.mockResolvedValue(instructorPayload);

    const res = await makeGet();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.activeStudentCount).toBe(1);
    expect(body.students).toHaveLength(1);
    expect(body.students[0]).toMatchObject({
      email: "student@example.com",
      sessionPackId: enrolmentRow.sessionPackId,
      remainingSessions: 2,
      lastSessionCompletedAt: enrolmentRow.lastSessionCompletedAt,
      seatStatus: "active",
    });
  });

  it("accepts the nullable fields real data actually contains", async () => {
    // Observed on the dev deployment: a student with no email on the user row
    // and no completed session. Both must parse, or the route 500s for real
    // instructors while the fixture-only tests stay green.
    query.mockResolvedValue({
      ...instructorPayload,
      activeStudentCount: 1,
      students: [
        {
          ...enrolmentRow,
          email: null,
          lastSessionCompletedAt: null,
          completedSessionCount: 0,
        },
      ],
    });

    const res = await makeGet();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.students[0]).toMatchObject({
      email: null,
      lastSessionCompletedAt: null,
      completedSessionCount: 0,
    });
  });

  it("404s when the instructor does not exist or is soft-deleted", async () => {
    query.mockResolvedValue(null);

    const res = await makeGet();

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "Instructor not found" });
  });

  it("404s when Convex rejects a malformed instructor id", async () => {
    query.mockRejectedValue(
      new Error(
        'ArgumentValidationError: Value "not-an-id" for field `instructorId` is not a valid ID.'
      )
    );

    const res = await GET(
      makeRequest({ url: "http://localhost/api/admin/instructors/not-an-id/students" }),
      makeContext("not-an-id")
    );

    expect(res.status).toBe(404);
  });

  it("500s loudly when the query returns the old grouped shape (shape-drift guard)", async () => {
    // What `getStudentsForAdmin` used to return: packs grouped per user. If the
    // route is ever rewired back to a grouped query without adapting, this fails
    // instead of silently emptying the UI.
    query.mockResolvedValue({
      items: [{ userId: "user_student_1", email: "student@example.com", sessionPacks: [] }],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    const res = await makeGet();

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "Invalid students payload" });
  });
});
