import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import OnboardingQuestionnaireForm from "./onboarding-questionnaire-form";

/**
 * The scheduling slot (currently the timezone picker) must remain
 * visible after the questionnaire is submitted. Students need to see
 * the timezone they set; only the Submit card is draft-only.
 *
 * Regression guard for the "timezone disappears after submit" report.
 */
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// The global setup mock is not applied to this file's module graph, so
// declare the router surface locally (same shape the component uses).
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

type FormInitial = React.ComponentProps<
  typeof OnboardingQuestionnaireForm
>["initial"];

function buildSubmittedInitial(): FormInitial {
  return {
    submission: {
      _id: "submission_1",
      onboardingId: "onboarding_1",
      status: "submitted",
      version: 1,
      answers: [
        { questionId: "goals", answerText: "Draw better characters" },
      ],
      inspirations: [{ name: "Peter Mohrbacher" }, { name: "VONNART" }],
      lastSeenAt: undefined,
      reminderCount: 0,
      lastReminderSentAt: undefined,
      submittedAt: 1_700_000_000_000,
      lastClientSaveId: 4,
    },
    workExamples: [],
  } as unknown as FormInitial;
}

function renderWithQueryClient(ui: React.ReactElement): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe("OnboardingQuestionnaireForm", () => {
  it("keeps the timezone/scheduling slot visible after submission", () => {
    renderWithQueryClient(
      <OnboardingQuestionnaireForm
        onboardingId="onboarding_1"
        initial={buildSubmittedInitial()}
        preSubmitSlot={<div data-testid="timezone-slot">America/Chicago</div>}
      />
    );

    expect(screen.getByTestId("timezone-slot")).toBeInTheDocument();
    expect(screen.getByText("Submitted")).toBeInTheDocument();
    // The student's answers remain visible read-only after submission.
    expect(screen.getByDisplayValue("Draw better characters")).toBeDisabled();
  });
});
