import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({ signOut: mocks.signOut }),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}));

vi.mock("@/components/ui/dialog", async () => {
  const React = await import("react");
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children);
  return {
    Dialog: Passthrough,
    DialogContent: Passthrough,
    DialogHeader: Passthrough,
    DialogDescription: Passthrough,
    DialogFooter: Passthrough,
    DialogTitle: Passthrough,
  };
});

vi.mock("@/components/ui/button", async () => {
  const React = await import("react");
  return {
    Button: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      React.createElement("button", props, children),
  };
});

// Imported AFTER mocks so the component module sees them.
import { SessionExpiryDialog } from "./session-expiry-dialog";

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
});

const renderDialog = (
  overrides: Partial<{
    returnPath: string | null;
    onSubmitAnyway: () => void;
  }> = {}
) => {
  const onOpenChange = vi.fn();
  const onJoinAnyway = overrides.onSubmitAnyway ?? vi.fn();
  render(
    <SessionExpiryDialog
      open
      expiresAt={new Date("2026-11-12T21:26:02.000Z")}
      returnPath={
        overrides.returnPath === undefined
          ? "/workspace/ws_1?join=sess_1"
          : overrides.returnPath
      }
      onOpenChange={onOpenChange}
      onJoinAnyway={onJoinAnyway}
    />
  );
  return { onOpenChange, onJoinAnyway };
};

describe("<SessionExpiryDialog>", () => {
  it("signs out through the bounce-redirect handler so the workspace return survives Clerk", async () => {
    renderDialog();

    await userEvent.click(
      screen.getByRole("button", { name: /sign in again/i })
    );

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledWith({
      redirectUrl:
        "/api/auth/bounce-redirect?redirect_url=" +
        encodeURIComponent("/workspace/ws_1?join=sess_1"),
    });
  });

  it("lets the user join anyway without signing out", async () => {
    const onJoinAnyway = vi.fn();
    renderDialog({ onSubmitAnyway: onJoinAnyway });

    await userEvent.click(screen.getByRole("button", { name: /join anyway/i }));

    expect(onJoinAnyway).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("shows a toast and stays on the dialog when sign-out fails", async () => {
    mocks.signOut.mockRejectedValueOnce(new Error("network down"));
    renderDialog();

    await userEvent.click(
      screen.getByRole("button", { name: /sign in again/i })
    );

    expect(mocks.toastError).toHaveBeenCalledWith(
      "Could not sign you out",
      expect.objectContaining({ description: "network down" })
    );
  });
});
