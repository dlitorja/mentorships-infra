import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "tests/unit/test-utils";
import StudentsPage from "./page";

/**
 * The students list used to forward only `search` to a paginated API (default
 * 20/page), print the loaded-page length as "Showing N results", and fall back
 * to a raw Clerk id as the headline when a student had no email. These tests pin
 * the three fixes: real page numbers, an honest count, and a human headline.
 */
const mocks = vi.hoisted(() => ({
  getAdminStudents: vi.fn(),
  getAdminInstructors: vi.fn(),
  addAdminStudentSessions: vi.fn(),
}));

vi.mock("@/lib/queries/api-client", () => ({
  getAdminStudents: mocks.getAdminStudents,
  getAdminInstructors: mocks.getAdminInstructors,
  addAdminStudentSessions: mocks.addAdminStudentSessions,
}));

function student(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user_abc123",
    email: null,
    firstName: null,
    lastName: null,
    sessionPacks: [],
    ...overrides,
  };
}

function response(items: unknown[], total: number, page = 1) {
  return { items, total, page, pageSize: 20 };
}

beforeEach(() => {
  mocks.getAdminStudents.mockReset();
  mocks.getAdminInstructors.mockReset();
  mocks.addAdminStudentSessions.mockReset();
  mocks.getAdminInstructors.mockResolvedValue({ instructors: [] });
});

describe("StudentsPage", () => {
  it("reports the real page window and headlines people by name", async () => {
    mocks.getAdminStudents.mockResolvedValue(
      response(
        [
          student({ userId: "user_1", email: "ada@example.com", firstName: "Ada", lastName: "Lovelace" }),
          student({ userId: "user_2", email: "bob@example.com", firstName: "Bob" }),
        ],
        22,
        1
      )
    );

    renderWithProviders(<StudentsPage />);

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    // Email is secondary, not the headline.
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    // 2 items on page 2 of a 22-row result set.
    expect(screen.getByText("Showing 1–2 of 22")).toBeInTheDocument();
  });

  it("never renders a raw Clerk id as the headline", async () => {
    mocks.getAdminStudents.mockResolvedValue(
      response([student({ userId: "user_no_name_9Q", email: null })], 1)
    );

    renderWithProviders(<StudentsPage />);

    expect(await screen.findByText("Student (no name or email on file)")).toBeInTheDocument();
    // The id is still available, but labelled and secondary.
    expect(screen.getByText(/Clerk ID: user_no_name_9Q/)).toBeInTheDocument();
  });

  it("pages forward through the pager", async () => {
    mocks.getAdminStudents
      .mockResolvedValueOnce(response([student({ userId: "user_a", firstName: "Ada" })], 22, 1))
      .mockResolvedValueOnce(response([student({ userId: "user_b", firstName: "Bob" })], 22, 2));

    renderWithProviders(<StudentsPage />);

    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Showing 1–1 of 22")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => expect(screen.getByText("Bob")).toBeInTheDocument());
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("shows a retryable error instead of an empty roster", async () => {
    mocks.getAdminStudents.mockRejectedValue(new Error("Convex unavailable"));

    renderWithProviders(<StudentsPage />);

    expect(await screen.findByText(/Couldn't load students/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText(/No students yet/)).not.toBeInTheDocument();
  });

  it("distinguishes no-matches from an empty roster", async () => {
    mocks.getAdminStudents.mockResolvedValue(response([], 0));

    renderWithProviders(<StudentsPage />);

    expect(await screen.findByText("No students yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /invite a student/i })).toBeInTheDocument();
  });
});
