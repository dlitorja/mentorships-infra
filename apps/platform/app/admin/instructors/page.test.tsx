import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "tests/unit/test-utils";
import InstructorsPage from "./page";

/**
 * The roster previously came from `useAllInstructors` (Convex, capped at 100,
 * no stats) and filtered/searched client-side. It now asks the REST endpoint for
 * a page, a status filter and a search — these tests pin the columns, the
 * filters and the paging that the old table could not show.
 */
const mocks = vi.hoisted(() => ({
  getAdminInstructors: vi.fn(),
  deleteAdminInstructor: vi.fn(),
}));

vi.mock("@/lib/queries/api-client", () => ({
  getAdminInstructors: mocks.getAdminInstructors,
  deleteAdminInstructor: mocks.deleteAdminInstructor,
}));

vi.mock("./_components/backfill-images-panel", () => ({
  BackfillImagesPanel: () => <div data-testid="backfill-panel" />,
}));

function instructor(overrides: Record<string, unknown> = {}) {
  return {
    id: "inst_1",
    instructorId: "inst_1",
    userId: "user_inst_1",
    name: "Ada Instructor",
    email: "ada@example.com",
    displayName: "Ada Instructor",
    slug: "ada",
    specialties: ["Concept Art"],
    isActive: true,
    isListed: true,
    deletedAt: null,
    oneOnOneInventory: 3,
    groupInventory: 2,
    maxActiveStudents: 10,
    activeStudentCount: 4,
    productActiveOneOnOne: true,
    productActiveGroup: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function response(instructors: unknown[], total: number) {
  return { instructors, total, page: 1, pageSize: 20 };
}

beforeEach(() => {
  mocks.getAdminInstructors.mockReset();
  mocks.deleteAdminInstructor.mockReset();
});

describe("InstructorsPage", () => {
  it("shows capacity, inventory, status and listing state", async () => {
    mocks.getAdminInstructors.mockResolvedValue(response([instructor()], 1));

    renderWithProviders(<InstructorsPage />);

    expect(await screen.findByText("Ada Instructor")).toBeInTheDocument();
    // Capacity: 4 active of 10 max.
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("/ 10")).toBeInTheDocument();
    // Inventory, previously invisible entirely.
    expect(screen.getByText("1:1 3")).toBeInTheDocument();
    expect(screen.getByText("Group 2")).toBeInTheDocument();
    // The status badge (the filter trigger also renders the word "Active").
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getByText("Showing 1–1 of 1")).toBeInTheDocument();
  });

  it("badges unlisted and deleted instructors distinctly", async () => {
    mocks.getAdminInstructors.mockResolvedValue(
      response(
        [
          instructor({ instructorId: "inst_a", id: "inst_a", name: "Unlisted One", isListed: false }),
          instructor({
            instructorId: "inst_b",
            id: "inst_b",
            name: "Deleted One",
            deletedAt: Date.now(),
          }),
        ],
        2
      )
    );

    renderWithProviders(<InstructorsPage />);

    expect(await screen.findByText("Unlisted")).toBeInTheDocument();
    // A soft-deleted instructor reads as Deleted, not merely "Inactive".
    expect(screen.getByText("Deleted")).toBeInTheDocument();
    expect(screen.queryByText("Inactive")).not.toBeInTheDocument();
  });

  it("asks the server for the selected status instead of filtering loaded rows", async () => {
    mocks.getAdminInstructors.mockResolvedValue(response([instructor()], 1));

    renderWithProviders(<InstructorsPage />);
    await screen.findByText("Ada Instructor");

    expect(mocks.getAdminInstructors).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active", page: 1, pageSize: 20 })
    );

    // Radix Select: keyboard-driven selection in jsdom.
    const trigger = screen.getByLabelText("Filter by status");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(await screen.findByText("Inactive"));

    await waitFor(() =>
      expect(mocks.getAdminInstructors).toHaveBeenCalledWith(
        expect.objectContaining({ status: "inactive", page: 1 })
      )
    );
  });

  it("pages through the roster", async () => {
    mocks.getAdminInstructors
      .mockResolvedValueOnce(response([instructor()], 25))
      .mockResolvedValueOnce(
        response([instructor({ instructorId: "inst_2", id: "inst_2", name: "Second Page" })], 25)
      );

    renderWithProviders(<InstructorsPage />);
    expect(await screen.findByText("Ada Instructor")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => expect(screen.getByText("Second Page")).toBeInTheDocument());
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("renders a retryable error rather than an empty roster", async () => {
    mocks.getAdminInstructors.mockRejectedValue(new Error("Convex unavailable"));

    renderWithProviders(<InstructorsPage />);

    expect(await screen.findByText(/Couldn't load instructors/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
