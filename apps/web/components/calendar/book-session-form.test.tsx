import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BookSessionForm } from "./book-session-form";
import { renderWithProviders } from "../../../../tests/unit/test-utils";

const mockCreateSession = vi.fn();
const mockFetchAvailability = vi.fn();

const mockUseForm = vi.hoisted(() => {
  const React = require("react");
  return function useForm({ defaultValues }: { defaultValues: { selectedPackId: string } }) {
    const [selectedPackId, setSelectedPackId] = React.useState(defaultValues.selectedPackId);
    return {
      getFieldValue: (field: string) => (field === "selectedPackId" ? selectedPackId : undefined),
      setFieldValue: (field: string, value: string) => {
        if (field === "selectedPackId") {
          setSelectedPackId(value);
        }
      },
      Field: () => null,
      Subscribe: () => null,
    };
  };
});

vi.mock("@/lib/queries/convex", () => ({
  useCreateSession: () => ({
    mutateAsync: mockCreateSession,
    isPending: false,
  }),
}));

vi.mock("@/lib/queries/api-client", () => ({
  fetchInstructorAvailability: (...args: any[]) => mockFetchAvailability(...args),
}));

vi.mock("@tanstack/react-form", () => ({
  useForm: mockUseForm,
}));

const basePacks = [
  {
    id: "pack_1",
    instructorId: "instructor_1",
    remainingSessions: 3,
    expiresAt: null,
    status: "active",
  },
];

const mockSlots = [
  "2026-08-10T14:00:00.000Z",
  "2026-08-10T15:00:00.000Z",
  "2026-08-11T14:00:00.000Z",
];

function renderForm(packs = basePacks, userId = "user_1") {
  return renderWithProviders(<BookSessionForm packs={packs} userId={userId} />);
}

describe("BookSessionForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchAvailability.mockResolvedValue({
      availableSlots: mockSlots,
      truncated: false,
    });
  });

  it("shows empty state when no eligible packs", () => {
    renderForm([]);
    expect(screen.getByText(/don't have any active packs/i)).toBeInTheDocument();
  });

  it("renders pack dropdown and calls availability when slots are loaded", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox"), "pack_1");
    await user.click(screen.getByRole("button", { name: /load available slots/i }));

    await waitFor(() => {
      expect(mockFetchAvailability).toHaveBeenCalledWith(
        "instructor_1",
        expect.any(String),
        expect.any(String),
        60
      );
    });
  });

  it("shows available slot buttons", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(screen.getByRole("combobox"), "pack_1");
    await user.click(screen.getByRole("button", { name: /load available slots/i }));

    await waitFor(() => {
      expect(screen.getByText(/available times/i)).toBeInTheDocument();
    });

    const slotButtons = screen.getAllByRole("button").filter((b) => b.textContent?.includes("Aug"));
    expect(slotButtons.length).toBeGreaterThan(0);
  });

  it("calls createSession with correct payload when a slot is clicked", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(screen.getByRole("combobox"), "pack_1");
    await user.click(screen.getByRole("button", { name: /load available slots/i }));

    await waitFor(() => {
      expect(screen.getByText(/available times/i)).toBeInTheDocument();
    });

    const slotButton = screen.getAllByRole("button").find((b) =>
      b.textContent?.includes("Aug")
    );
    expect(slotButton).toBeDefined();
    await user.click(slotButton!);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          instructorId: "instructor_1",
          sessionPackId: "pack_1",
          studentId: "user_1",
          scheduledAt: expect.any(Number),
        })
      );
    });
  });

  it("shows error message when availability fails", async () => {
    mockFetchAvailability.mockRejectedValue(new Error("Network error"));
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(screen.getByRole("combobox"), "pack_1");
    await user.click(screen.getByRole("button", { name: /load available slots/i }));

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  it("shows google calendar not connected info when API returns 409", async () => {
    const error = new Error("Instructor calendar not connected");
    (error as Error & { code?: string }).code = "GOOGLE_CALENDAR_NOT_CONNECTED";
    mockFetchAvailability.mockRejectedValue(error);

    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(screen.getByRole("combobox"), "pack_1");
    await user.click(screen.getByRole("button", { name: /load available slots/i }));

    await waitFor(() => {
      expect(screen.getByText(/hasn't connected google calendar/i)).toBeInTheDocument();
    });
  });

  it("filters out expired packs", () => {
    const expiredPacks = [
      {
        id: "pack_2",
        instructorId: "instructor_2",
        remainingSessions: 1,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        status: "active",
      },
    ];
    renderForm(expiredPacks);
    expect(screen.getByText(/don't have any active packs/i)).toBeInTheDocument();
  });
});
