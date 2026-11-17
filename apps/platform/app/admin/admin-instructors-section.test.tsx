import React, { Suspense } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "tests/unit/test-utils";
import { AdminInstructorsSection } from "./admin-instructors-section";

/**
 * The dashboard instructor widget used to convert *any* failed student fetch
 * into `[]`, which rendered as the truthful-looking "No students assigned yet".
 * These tests pin the two behaviours that made that possible:
 *
 *  1. A load failure renders an error with a Retry — never the empty state.
 *  2. A genuinely empty result still renders the empty state.
 */
const mocks = vi.hoisted(() => {
  class ApiFetchError extends Error {
    data: unknown;
    constructor(message: string, data?: unknown) {
      super(message);
      this.name = "ApiFetchError";
      this.data = data;
    }
  }
  return {
    ApiFetchError,
    getAdminInstructors: vi.fn(),
    getAdminInstructorStudents: vi.fn(),
    updateAdminInstructor: vi.fn(),
  };
});

vi.mock("@/lib/queries/api-client", () => ({
  ApiFetchError: mocks.ApiFetchError,
  getAdminInstructors: mocks.getAdminInstructors,
  getAdminInstructorStudents: mocks.getAdminInstructorStudents,
  updateAdminInstructor: mocks.updateAdminInstructor,
}));

const instructor = {
  instructorId: "inst_1",
  userId: "user_1",
  email: "instructor@example.com",
  name: "Ada Instructor",
  oneOnOneInventory: 3,
  groupInventory: 2,
  maxActiveStudents: 10,
  activeStudentCount: 4,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function renderWidget() {
  return renderWithProviders(
    <Suspense fallback={<div>loading</div>}>
      <AdminInstructorsSection />
    </Suspense>
  );
}

beforeEach(() => {
  mocks.getAdminInstructors.mockResolvedValue({ instructors: [instructor] });
  mocks.getAdminInstructorStudents.mockReset();
  mocks.updateAdminInstructor.mockResolvedValue({ success: true });
});

describe("AdminInstructorsSection student expansion", () => {
  it("renders an error with Retry when the student fetch fails, not an empty state", async () => {
    mocks.getAdminInstructorStudents.mockRejectedValue(
      new mocks.ApiFetchError("Invalid students payload", { error: "Invalid students payload" })
    );

    renderWidget();

    fireEvent.click(await screen.findByText("instructor@example.com"));

    expect(await screen.findByText(/Couldn't load students/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("No students assigned yet")).not.toBeInTheDocument();
  });

  it("renders a list-load failure inline instead of blanking the page", async () => {
    mocks.getAdminInstructors.mockRejectedValue(new Error("Convex unavailable"));

    renderWidget();

    expect(await screen.findByText(/Couldn't load instructors/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    // The empty-roster copy must not appear for a failure.
    expect(screen.queryByText(/No instructors yet/)).not.toBeInTheDocument();
  });

  it("still renders the empty state for a successful empty result", async () => {
    mocks.getAdminInstructorStudents.mockResolvedValue({ students: [], activeStudentCount: 0 });

    renderWidget();

    fireEvent.click(await screen.findByText("instructor@example.com"));

    expect(await screen.findByText("No students assigned yet")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load students/)).not.toBeInTheDocument();
  });

  it("renders real last-session data and distinguishes active students from enrollments", async () => {
    mocks.getAdminInstructorStudents.mockResolvedValue({
      activeStudentCount: 1,
      students: [
        {
          userId: "user_2",
          email: "student@example.com",
          sessionPackId: "pack_1",
          totalSessions: 4,
          remainingSessions: 2,
          status: "active",
          expiresAt: Date.UTC(2026, 5, 1),
          // Midday UTC so the rendered local date is stable in any timezone.
          lastSessionCompletedAt: Date.UTC(2026, 0, 9, 12),
          completedSessionCount: 2,
          seatStatus: "active",
          seatExpiresAt: null,
        },
      ],
    });

    renderWidget();

    fireEvent.click(await screen.findByText("instructor@example.com"));

    // Column exists and carries the real last-session date, not the purchase date.
    expect(await screen.findByText("Last session")).toBeInTheDocument();
    expect(screen.getByText(/Jan 9, 2026/)).toBeInTheDocument();
    // Canonical count vs row count are labelled separately.
    expect(screen.getByText(/1 active student/)).toBeInTheDocument();
    expect(screen.getByText(/1 enrollment/)).toBeInTheDocument();
  });
});
