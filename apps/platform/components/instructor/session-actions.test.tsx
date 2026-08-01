import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionActions, type SessionActionSession } from "./session-actions";
import { renderWithProviders } from "../../../../tests/unit/test-utils";

const { mockRouter, mockRouterModule } = vi.hoisted(() => {
  const mockRouter = {
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  };
  return {
    mockRouter,
    mockRouterModule: {
      useRouter: () => mockRouter,
      usePathname: () => "/",
      useSearchParams: () => new URLSearchParams(),
    },
  };
});

const mockReschedule = vi.fn();
const mockCancel = vi.fn();
const mockNotes = vi.fn();
const mockUseCurrentInstructor = vi.fn();

vi.mock("next/navigation", () => mockRouterModule);

vi.mock("../../lib/queries/convex", () => ({
  useCurrentInstructor: () => mockUseCurrentInstructor(),
}));

vi.mock("../../lib/queries/use-session-actions", () => ({
  useRescheduleSession: () => ({
    mutate: mockReschedule,
    isPending: false,
  }),
  useCancelSession: () => ({
    mutate: mockCancel,
    isPending: false,
  }),
  useUpdateSessionNotes: () => ({
    mutate: mockNotes,
    isPending: false,
  }),
}));

const baseSession: SessionActionSession = {
  id: "session_123",
  scheduledAt: new Date("2026-08-15T18:00:00Z").getTime(),
  studentEmail: "student@example.com",
  notes: "Initial notes",
  status: "scheduled",
};

function renderActions(session = baseSession, allowedActions?: Array<"reschedule" | "cancel" | "notes">) {
  return renderWithProviders(
    <SessionActions session={session} allowedActions={allowedActions} />
  );
}

describe("SessionActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCurrentInstructor.mockReturnValue({
      data: { timeZone: "America/New_York" },
      isLoading: false,
      isError: false,
    });
  });

  it("renders reschedule, cancel, and notes buttons", () => {
    renderActions();
    expect(screen.getByRole("button", { name: /reschedule session/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel session/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /session notes/i })).toBeInTheDocument();
  });

  it("renders only allowed actions", () => {
    renderActions(baseSession, ["notes"]);
    expect(screen.queryByRole("button", { name: /reschedule session/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel session/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /session notes/i })).toBeInTheDocument();
  });

  it("disables reschedule while timezone is loading", () => {
    mockUseCurrentInstructor.mockReturnValue({
      data: null,
      isLoading: true,
      isError: false,
    });
    renderActions();
    expect(screen.getByRole("button", { name: /reschedule session/i })).toBeDisabled();
  });

  it("disables reschedule when instructor has no valid timezone", () => {
    mockUseCurrentInstructor.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
    });
    renderActions();
    expect(screen.getByRole("button", { name: /reschedule session/i })).toBeDisabled();
  });

  it("opens reschedule dialog and calls mutation with correct UTC timestamp", async () => {
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole("button", { name: /reschedule session/i }));
    expect(screen.getByRole("dialog", { name: /reschedule session/i })).toBeInTheDocument();

    const datetimeInput = screen.getByLabelText(/new date and time/i);
    await user.clear(datetimeInput);
    await user.type(datetimeInput, "2026-08-16T14:00");

    await user.click(screen.getByRole("button", { name: /reschedule$/i }));

    await waitFor(() => {
      expect(mockReschedule).toHaveBeenCalledWith(
        {
          sessionId: baseSession.id,
          newScheduledAt: expect.any(Number),
        },
        expect.any(Object)
      );
    });
  });

  it("closes reschedule dialog without calling mutation", async () => {
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole("button", { name: /reschedule session/i }));
    await user.click(screen.getByRole("button", { name: /cancel$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /reschedule session/i })).not.toBeInTheDocument();
    });
    expect(mockReschedule).not.toHaveBeenCalled();
  });

  it("opens cancel dialog and calls cancel mutation with reason", async () => {
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole("button", { name: /cancel session/i }));
    expect(screen.getByRole("dialog", { name: /cancel session/i })).toBeInTheDocument();

    const reasonInput = screen.getByLabelText(/reason/i);
    await user.type(reasonInput, "Need to reschedule");

    await user.click(screen.getByRole("button", { name: /cancel session$/i }));

    await waitFor(() => {
      expect(mockCancel).toHaveBeenCalledWith(
        {
          sessionId: baseSession.id,
          reason: "Need to reschedule",
        },
        expect.any(Object)
      );
    });
  });

  it("keeps session when cancel dialog is dismissed", async () => {
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole("button", { name: /cancel session/i }));
    await user.click(screen.getByRole("button", { name: /keep session/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /cancel session/i })).not.toBeInTheDocument();
    });
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it("opens notes dialog and saves notes", async () => {
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole("button", { name: /session notes/i }));
    expect(screen.getByRole("dialog", { name: /session notes/i })).toBeInTheDocument();

    const notesInput = screen.getByRole("textbox", { name: /notes/i });
    await user.clear(notesInput);
    await user.type(notesInput, "Updated notes");

    await user.click(screen.getByRole("button", { name: /save notes/i }));

    await waitFor(() => {
      expect(mockNotes).toHaveBeenCalledWith(
        {
          sessionId: baseSession.id,
          notes: "Updated notes",
        },
        expect.any(Object)
      );
    });
  });

  it("disables reschedule button on timezone error", () => {
    mockUseCurrentInstructor.mockReturnValue({
      data: null,
      isLoading: false,
      isError: true,
    });
    renderActions();
    expect(screen.getByRole("button", { name: /reschedule session/i })).toBeDisabled();
  });
});
