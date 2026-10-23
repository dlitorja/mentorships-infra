import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminOnboardingDetailPage from "./page";
import {
  useAdminOnboarding,
  useSubmittedQuestionnaire,
  useOnboardingWorkExamples,
} from "@/lib/queries/convex/use-admin-onboardings";

// The three Convex hooks the page consumes. Tests assemble each
// hook's return value per case below.
vi.mock("@/lib/queries/convex/use-admin-onboardings", () => ({
  useAdminOnboarding: vi.fn(),
  useSubmittedQuestionnaire: vi.fn(),
  useOnboardingWorkExamples: vi.fn(),
}));

// Stub the Retry/Resend buttons so the test doesn't pull in their
// API client + Convex mutation dependencies.
vi.mock("@/components/admin/retry-onboarding-button", () => ({
  RetryOnboardingButton: () => <button data-testid="retry-stub">Retry</button>,
}));
vi.mock("@/components/admin/resend-invitation-button", () => ({
  ResendInvitationButton: () => (
    <button data-testid="resend-stub">Resend</button>
  ),
}));

// WorkExampleThumb hits the signed-URL API route on mount via
// apiFetch — fine in a browser, but in jsdom it would loop on the
// `(image)` fallback forever. Stub it so each tile renders text
// the test can assert on.
vi.mock("@/components/onboarding/work-example-thumb", () => ({
  WorkExampleThumb: ({ fileName }: { fileName: string }) => (
    <div data-testid="work-example-thumb">{fileName}</div>
  ),
}));

// Override the global `next/navigation` mock so `useParams`
// returns our test-controlled value. `vi.mock` is hoisted to the
// top of the file, so this wins over the lighter global stub.
const paramsStore: { value: Record<string, string> } = { value: {} };
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => paramsStore.value,
}));

const mockedUseAdminOnboarding = vi.mocked(useAdminOnboarding);
const mockedUseSubmittedQuestionnaire = vi.mocked(useSubmittedQuestionnaire);
const mockedUseOnboardingWorkExamples = vi.mocked(useOnboardingWorkExamples);

const SAMPLE_ID = "jx7abc12adminOnboardings0";

const sampleAdminOnboarding = {
  _id: SAMPLE_ID,
  _creationTime: 1_700_000_000_000,
  email: "student@example.com",
  source: "kajabi",
  status: "completed",
  attemptCount: 1,
  flowVersion: 1,
  submittedByUserId: "user_admin_42",
  perInstructor: [
    {
      instructorId: "jx7instr01instructors0",
      isRenewal: false,
      sessionsPerInstructor: 4,
      workspaceId: "jx7ws01workspaces0",
    },
  ],
  // PR 14 — timezone set; should render in the Summary card.
  studentTimezone: "America/New_York",
  studentTimezoneSetAt: 1_700_000_005_000,
  timeline: [
    { at: 1_700_000_000_000, event: "queued", actorUserId: "user_admin_42" },
  ],
  createdAt: 1_700_000_000_000,
};

const sampleQuestionnaireSubmission = {
  submission: {
    submittedAt: 1_700_000_100_000,
    questionnaireVersion: 1,
    answers: [
      {
        questionId: "how_did_you_hear",
        questionText: "",
        answerText: "A friend told me about the program.",
      },
      {
        questionId: "goals",
        questionText: "",
        answerText: "I want to learn more about oil painting.",
      },
    ],
    inspirations: [{ name: "Frida Kahlo" }, { name: "David Hockney" }],
  },
  workExamples: [],
} as const;

const sampleActiveWorkExamples = [
  {
    _id: "jx7ex1onboardingWorkExamples0",
    status: "active",
    fileName: "sketch-01.jpg",
    b2Key: "students/abc/sketch-01.jpg",
    contentType: "image/jpeg",
    size: 12345,
    uploadedAt: 1_700_000_080_000,
  },
] as const;

function renderPage() {
  return render(<AdminOnboardingDetailPage />);
}

describe("AdminOnboardingDetailPage — Student questionnaire card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Each test sets `paramsStore.value` after this; the page calls
    // the three hooks BEFORE its `if (!id)` early return, so the
    // hooks must always return a well-formed envelope, even on the
    // empty-id path.
    mockedUseAdminOnboarding.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    } as any);
    mockedUseSubmittedQuestionnaire.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    } as any);
    mockedUseOnboardingWorkExamples.mockReturnValue({
      data: [],
      isLoading: true,
      error: null,
    } as any);
    paramsStore.value = { id: SAMPLE_ID };
  });

  it("renders the empty-id error pane when the URL has no id", () => {
    paramsStore.value = {};

    renderPage();

    expect(
      screen.getByText(/missing onboarding id in the url/i)
    ).toBeInTheDocument();
  });

  it("renders the 'Not yet submitted' state when the questionnaire hook returns null", () => {
    mockedUseAdminOnboarding.mockReturnValue({
      data: sampleAdminOnboarding,
      isLoading: false,
      error: null,
    } as any);
    mockedUseSubmittedQuestionnaire.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    } as any);
    mockedUseOnboardingWorkExamples.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as any);

    renderPage();

    expect(screen.getByText(/student questionnaire/i)).toBeInTheDocument();
    expect(
      screen.getByText(/not yet submitted by the student/i)
    ).toBeInTheDocument();
    // The Summary card shows the timezone we set on the sample row.
    expect(screen.getByText(/student timezone/i)).toBeInTheDocument();
    expect(screen.getByText("America/New_York")).toBeInTheDocument();
  });

  it("renders the populated card with answers, inspirations, and work examples when data is present", () => {
    mockedUseAdminOnboarding.mockReturnValue({
      data: sampleAdminOnboarding,
      isLoading: false,
      error: null,
    } as any);
    mockedUseSubmittedQuestionnaire.mockReturnValue({
      data: sampleQuestionnaireSubmission,
      isLoading: false,
      error: null,
    } as any);
    mockedUseOnboardingWorkExamples.mockReturnValue({
      data: sampleActiveWorkExamples,
      isLoading: false,
      error: null,
    } as any);

    renderPage();

    const card = screen.getByTestId("admin-onboarding-questionnaire-card");
    expect(card).toBeInTheDocument();

    // Submitted timestamp is shown in the description.
    expect(card.textContent).toMatch(/submitted/i);

    // Answer text is in the rendered card. We don't assert on
    // question labels here because the page prefers the stored
    // `questionText` over the canonical one (and we left the
    // stored value empty in the fixture to exercise the canonical
    // fallback path).
    expect(card.textContent).toMatch(/A friend told me about the program/);
    expect(card.textContent).toMatch(/oil painting/i);

    // Inspirations list is rendered.
    expect(card.textContent).toMatch(/Frida Kahlo/);
    expect(card.textContent).toMatch(/David Hockney/);

    // Work examples section renders the mocked thumb. The fileName
    // appears twice on purpose (once inside the thumb stub, once
    // in the line-clamped footer label) so check the data-testid
    // count instead of asserting on the literal text.
    const thumbs = screen.getAllByTestId("work-example-thumb");
    expect(thumbs).toHaveLength(1);
  });

  it("renders the loading spinner inside the questionnaire card while the hook is loading", () => {
    mockedUseAdminOnboarding.mockReturnValue({
      data: sampleAdminOnboarding,
      isLoading: false,
      error: null,
    } as any);
    mockedUseSubmittedQuestionnaire.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as any);
    mockedUseOnboardingWorkExamples.mockReturnValue({
      data: [],
      isLoading: true,
      error: null,
    } as any);

    renderPage();

    expect(
      screen.getByText(/loading student responses/i)
    ).toBeInTheDocument();
  });

  // Greptile round-1 P2 (PR #953): a failed request must NOT be
  // confusable with "the student hasn't submitted." Verify the
  // questionnaire hook's error state renders an explicit
  // "couldn't load" panel instead of "not yet submitted."
  it("renders an explicit error state when the questionnaire hook fails (not 'not yet submitted')", () => {
    mockedUseAdminOnboarding.mockReturnValue({
      data: sampleAdminOnboarding,
      isLoading: false,
      isError: false,
      error: null,
    } as any);
    mockedUseSubmittedQuestionnaire.mockReturnValue({
      data: null,
      isLoading: false,
      isError: true,
      error: new Error("Convex unreachable"),
    } as any);
    mockedUseOnboardingWorkExamples.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    } as any);

    renderPage();

    const card = screen.getByTestId("admin-onboarding-questionnaire-card");
    expect(card.textContent).toMatch(/couldn'?t load the student/i);
    expect(card.textContent).not.toMatch(/not yet submitted by the student/i);
    // The underlying error string is surfaced for support.
    expect(card.textContent).toMatch(/Convex unreachable/);
  });

  // Greptile round-1 P2 (PR #953): same treatment for the
  // work-examples query. A failure comes through as an explicit
  // panel, not "no work examples attached."
  it("renders an explicit error state when the work-examples hook fails (not 'no work examples attached')", () => {
    mockedUseAdminOnboarding.mockReturnValue({
      data: sampleAdminOnboarding,
      isLoading: false,
      isError: false,
      error: null,
    } as any);
    mockedUseSubmittedQuestionnaire.mockReturnValue({
      data: sampleQuestionnaireSubmission,
      isLoading: false,
      isError: false,
      error: null,
    } as any);
    mockedUseOnboardingWorkExamples.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      error: new Error("Signed-URL endpoint 503"),
    } as any);

    renderPage();

    const card = screen.getByTestId("admin-onboarding-questionnaire-card");
    expect(card.textContent).toMatch(/couldn'?t load work examples/i);
    expect(card.textContent).not.toMatch(/no work examples attached/i);
    expect(card.textContent).toMatch(/Signed-URL endpoint 503/);
  });
});
