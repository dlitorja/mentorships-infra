import React, { Suspense } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "tests/unit/test-utils";
import WorkspaceMembersPage from "./page";

/**
 * Transferring workspace ownership is the most destructive action in this
 * cluster and used to fire on a single click. It must name the new owner and
 * its consequences before anything happens.
 */
const mocks = vi.hoisted(() => ({
  getAdminWorkspace: vi.fn(),
  getAdminInstructors: vi.fn(),
  getAdminStudents: vi.fn(),
  updateAdminWorkspaceMembers: vi.fn(),
}));

vi.mock("@/lib/queries/api-client", () => ({
  getAdminWorkspace: mocks.getAdminWorkspace,
  getAdminInstructors: mocks.getAdminInstructors,
  getAdminStudents: mocks.getAdminStudents,
  updateAdminWorkspaceMembers: mocks.updateAdminWorkspaceMembers,
}));

// Created once: a fresh promise per render would suspend forever.
const params = Promise.resolve({ id: "ws_1" });

const workspace = {
  id: "ws_1",
  name: "Ada × Instructor",
  description: null,
  type: "mentorship" as const,
  ownerId: "user_old",
  owner: { userId: "user_old", email: "old@example.com", firstName: "Old" },
  instructorId: "inst_1",
  instructor: { id: "inst_1", userId: "user_inst", bio: null },
};

async function renderAndPickNewOwner() {
  // `use(params)` suspends on first render; flush the promise inside act so the
  // component leaves the Suspense fallback before we query it.
  await act(async () => {
    renderWithProviders(
      <Suspense fallback={<div>loading</div>}>
        <WorkspaceMembersPage params={params} />
      </Suspense>
    );
  });

  const search = await screen.findByPlaceholderText("Search by email...", {}, { timeout: 3000 });
  fireEvent.change(search, { target: { value: "new@example.com" } });

  // Debounce (300ms) then the student search resolves.
  const result = await screen.findByRole(
    "button",
    { name: /new@example\.com/ },
    { timeout: 3000 }
  );
  fireEvent.click(result);
  return result;
}

beforeEach(() => {
  mocks.getAdminWorkspace.mockReset().mockResolvedValue(workspace);
  mocks.getAdminInstructors.mockReset().mockResolvedValue({ instructors: [] });
  mocks.getAdminStudents.mockReset().mockResolvedValue({
    items: [{ userId: "user_new", email: "new@example.com", firstName: "New" }],
    total: 1,
  });
  mocks.updateAdminWorkspaceMembers.mockReset().mockResolvedValue({ success: true });
});

describe("WorkspaceMembersPage ownership transfer", () => {
  it("asks for confirmation, naming the new owner, before transferring", async () => {
    await renderAndPickNewOwner();

    fireEvent.click(screen.getByRole("button", { name: /transfer ownership/i }));

    // Nothing has been sent yet; the dialog explains what will happen.
    expect(mocks.updateAdminWorkspaceMembers).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/Transfer workspace ownership/i);
    expect(dialog).toHaveTextContent(/new@example\.com|New/);
    expect(dialog).toHaveTextContent(/session packs/i);

    fireEvent.click(within(dialog).getByRole("button", { name: "Transfer ownership" }));

    await waitFor(() =>
      expect(mocks.updateAdminWorkspaceMembers).toHaveBeenCalledWith("ws_1", {
        newOwnerId: "user_new",
      })
    );
  });

  it("cancelling the dialog transfers nothing", async () => {
    await renderAndPickNewOwner();

    fireEvent.click(screen.getByRole("button", { name: /transfer ownership/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(mocks.updateAdminWorkspaceMembers).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
