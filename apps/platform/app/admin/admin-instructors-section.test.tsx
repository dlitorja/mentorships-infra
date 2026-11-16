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

  it("still renders the empty state for a successful empty result", async () => {
    mocks.getAdminInstructorStudents.mockResolvedValue({ students: [] });

    renderWidget();

    fireEvent.click(await screen.findByText("instructor@example.com"));

    expect(await screen.findByText("No students assigned yet")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load students/)).not.toBeInTheDocument();
  });

  it("labels the purchase-date column honestly", async () => {
    mocks.getAdminInstructorStudents.mockResolvedValue({
      students: [
        {
          id: "pack_1",
          userId: "user_2",
          email: "student@example.com",
          instructorId: "inst_1",
          instructorName: "Ada Instructor",
          instructorSlug: "ada",
          totalSessions: 4,
          remainingSessions: 2,
          purchasedAt: Date.UTC(2026, 0, 2),
          expiresAt: null,
          status: "active",
          createdAt: Date.UTC(2026, 0, 2),
        },
      ],
    });

    renderWidget();

    fireEvent.click(await screen.findByText("instructor@example.com"));

    expect(await screen.findByText("Purchased")).toBeInTheDocument();
    expect(screen.queryByText("Last Session")).not.toBeInTheDocument();
  });
});
