import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InstructorStudentsPage from "./page";
import { ApiFetchError, apiFetch } from "@/lib/queries/api-client";

vi.mock("@/lib/queries/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queries/api-client")>(
    "@/lib/queries/api-client",
  );
  return {
    ...actual,
    apiFetch: vi.fn(),
    updateSessionPack: vi.fn(),
  };
});

const mockApiFetch = vi.mocked(apiFetch);

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("InstructorStudentsPage — reconciliation 409 handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the reconciliation guidance when /api/instructor/students returns instructor_linking_needs_reconciliation", async () => {
    mockApiFetch.mockRejectedValueOnce(
      new ApiFetchError(
        "Instructor account is linked to a different sign-in. Contact support to relink.",
        409,
        {
          error:
            "Instructor account is linked to a different sign-in. Contact support to relink.",
          code: "instructor_linking_needs_reconciliation",
          instructorId: "instructor_abc123",
          email: "rakasa.art@gmail.com",
          existingClerkUserId: "user_oldClerk1234567890",
        },
      ),
    );

    renderWithQueryClient(<InstructorStudentsPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /sign-in account doesn't match/i }),
      ).toBeInTheDocument();
    });

    // Email appears in both the structured field grid AND the closing
    // instructional paragraph, so use getAllByText + count.
    const emailNodes = screen.getAllByText(/rakasa.art@gmail\.com/i);
    expect(emailNodes.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/user_oldClerk1234567890/i)).toBeInTheDocument();
    expect(screen.getByText(/instructor_abc123/i)).toBeInTheDocument();
    expect(screen.getByText(/sign out and sign back in/i)).toBeInTheDocument();
  });

  it("falls back to the generic error card when the 409 is not the reconciliation shape", async () => {
    mockApiFetch.mockRejectedValueOnce(
      new ApiFetchError("Some other 409", 409, {
        code: "some_other_code",
      }),
    );

    renderWithQueryClient(<InstructorStudentsPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/failed to load students: some other 409/i),
      ).toBeInTheDocument();
    });
  });

  it("falls back to the generic error card when the failure is not a 409", async () => {
    mockApiFetch.mockRejectedValueOnce(new ApiFetchError("Boom", 500, { error: "Boom" }));

    renderWithQueryClient(<InstructorStudentsPage />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load students: boom/i)).toBeInTheDocument();
    });
  });
});
