import React, { Suspense } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "tests/unit/test-utils";
import WorkspaceSettingsPage from "./page";

/**
 * "Accessible without authentication" was a bare Switch: private → public is
 * the one setting on this page that widens access, so it now asks first.
 */
const mocks = vi.hoisted(() => ({
  getAdminWorkspace: vi.fn(),
  updateAdminWorkspace: vi.fn(),
}));

vi.mock("@/lib/queries/api-client", () => ({
  getAdminWorkspace: mocks.getAdminWorkspace,
  updateAdminWorkspace: mocks.updateAdminWorkspace,
}));

const params = Promise.resolve({ id: "ws_1" });

const workspace = {
  id: "ws_1",
  name: "Ada × Instructor",
  description: null,
  type: "mentorship" as const,
  ownerId: "user_old",
  isPublic: false,
  endedAt: null,
  createdAt: 1,
};

beforeEach(() => {
  mocks.getAdminWorkspace.mockReset().mockResolvedValue(workspace);
  mocks.updateAdminWorkspace.mockReset().mockResolvedValue({ success: true });
});

async function renderPage() {
  await act(async () => {
    renderWithProviders(
      <Suspense fallback={<div>loading</div>}>
        <WorkspaceSettingsPage params={params} />
      </Suspense>
    );
  });
  await screen.findByLabelText("Public Visibility", {}, { timeout: 3000 });
}

describe("WorkspaceSettingsPage public visibility", () => {
  it("confirms before making a workspace publicly accessible", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("switch", { name: /public visibility/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/without signing in/i);
    // Nothing is saved until the admin confirms and saves.
    expect(mocks.updateAdminWorkspace).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /yes, make it public/i }));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(mocks.updateAdminWorkspace).toHaveBeenCalledWith(
        "ws_1",
        expect.objectContaining({ isPublic: true })
      )
    );
  });

  it("cancelling leaves the workspace private", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("switch", { name: /public visibility/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(mocks.updateAdminWorkspace).toHaveBeenCalledWith(
        "ws_1",
        expect.objectContaining({ isPublic: false })
      )
    );
  });
});
