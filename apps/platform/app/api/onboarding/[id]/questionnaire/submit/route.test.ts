/**
 * HUC-94 — Route tests for POST /api/onboarding/[id]/questionnaire/submit.
 *
 * Finalizes the questionnaire. Server-side `submitQuestionnaire`
 * enforces all the rules the form pre-checks client-side:
 *
 *   - assigned-student auth (re-verified on the server)
 *   - every required question id has a non-empty answer
 *   - inspiration count meets `MIN_INSPIRATIONS`
 *   - work-example count meets `MIN_WORK_EXAMPLES_PER_SUBMISSION`
 *
 * The route maps `submitQuestionnaire` errors that match the
 * `missing required | not enough work | inspirations` pattern into
 * a 422 (semantic client error) instead of 500. Other failures stay
 * 500. These tests pin the mapping so a future error-message tweak
 * doesn't accidentally surface user-facing copy as a 500.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { auth } from "@clerk/nextjs/server";

import { POST } from "./route";
import { makeRequest } from "tests/unit/api-route-utils";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { reportError } from "@/lib/observability";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/convex", () => ({
  getAuthenticatedConvexClient: vi.fn(),
}));

vi.mock("@/lib/errors", () => ({
  isUnauthorizedError: (error: unknown) =>
    error instanceof Error && error.message.includes("Unauthorized"),
  isForbiddenError: (error: unknown) =>
    error instanceof Error && error.message.includes("Forbidden"),
}));

vi.mock("@/lib/observability", () => ({
  reportError: vi.fn(),
}));

const convexClient = {
  query: vi.fn(),
  mutation: vi.fn(),
  action: vi.fn(),
};

const mockAuth = vi.mocked(auth);
const mockGetAuthenticatedConvexClient = vi.mocked(getAuthenticatedConvexClient);
const mockReportError = vi.mocked(reportError);


// The Convex `anyApi` Proxy does not expose a usable toString for
// mock introspect. The function name is stored under the
// `functionName` symbol as `<module>:<function>` — read it back so
// each test can pin which Convex function the route called.
const FN_SYMBOL = Symbol.for("functionName");
function fnName(ref: any): string {
  return ref[FN_SYMBOL] as string;
}


const onboardingId = "ab1234567890";

function makeSubmitRequest(body: object) {
  return {
    request: makeRequest({
      method: "POST",
      url: `https://platform.test/api/onboarding/${onboardingId}/questionnaire/submit`,
      body,
    }),
    params: Promise.resolve({ id: onboardingId }),
  };
}

describe("POST /api/onboarding/[id]/questionnaire/submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_student_alice" } as any);
    mockGetAuthenticatedConvexClient.mockResolvedValue(convexClient);
    convexClient.mutation.mockResolvedValue({
      _id: "sub_1",
      status: "submitted",
      submittedAt: 1234567890,
    });
  });

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce({ userId: null } as any);
    const { request, params } = makeSubmitRequest({
      answers: [],
      inspirations: [],
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(convexClient.mutation).not.toHaveBeenCalled();
  });

  it("returns 400 when answers is missing", async () => {
    const { request, params } = makeSubmitRequest({ inspirations: [] });
    const response = await POST(request, { params });
    expect(response.status).toBe(400);
    expect(convexClient.mutation).not.toHaveBeenCalled();
  });

  it("returns 400 when an answer is missing questionText", async () => {
    const { request, params } = makeSubmitRequest({
      answers: [{ questionId: "q1", answerText: "x" }], // missing questionText
      inspirations: [],
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(400);
  });

  it("forwards the full submit payload to submitQuestionnaire", async () => {
    const { request, params } = makeSubmitRequest({
      answers: [
        { questionId: "q1", questionText: "How did you hear about us?", answerText: "Friend" },
        { questionId: "q2", questionText: "Goals", answerText: "Learn guitar" },
      ],
      inspirations: [{ name: "Hendrix" }],
    });

    const response = await POST(request, { params });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      submission: { _id: "sub_1", status: "submitted", submittedAt: 1234567890 },
    });

    expect(convexClient.mutation).toHaveBeenCalledTimes(1);
    const [ref, args] = convexClient.mutation.mock.calls[0] as [any, any];
    expect(fnName(ref)).toContain("submitQuestionnaire");
    // Server stamps the version
    expect(args.questionnaireVersion).toBeDefined();
    // Client-supplied `questionText` is ACCEPTED on submit (unlike
    // PATCH, where the server stamps it from the canonical list).
    // Pin that to guard against a future refactor flipping the two.
    expect(args.answers[0].questionText).toBe("How did you hear about us?");
    expect(args.inspirations).toEqual([{ name: "Hendrix" }]);
  });

  it("returns 422 when the mutation rejects with a 'missing required' message", async () => {
    convexClient.mutation.mockRejectedValueOnce(
      new Error("missing required answers for q1")
    );

    const { request, params } = makeSubmitRequest({
      answers: [{ questionId: "q1", questionText: "x", answerText: "" }],
      inspirations: [],
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "missing required answers for q1",
    });
    expect(mockReportError).toHaveBeenCalledTimes(1);
  });

  it("returns 422 when the mutation rejects with a 'not enough work' message", async () => {
    convexClient.mutation.mockRejectedValueOnce(
      new Error("not enough work examples: need 3")
    );

    const { request, params } = makeSubmitRequest({
      answers: [{ questionId: "q1", questionText: "x", answerText: "y" }],
      inspirations: [],
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(422);
  });

  it("returns 422 when the mutation rejects with an 'inspirations' message", async () => {
    convexClient.mutation.mockRejectedValueOnce(
      new Error("inspirations: too few (1 < 2)")
    );

    const { request, params } = makeSubmitRequest({
      answers: [{ questionId: "q1", questionText: "x", answerText: "y" }],
      inspirations: [{ name: "x" }],
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(422);
  });

  it("returns 500 when the mutation rejects with an unrelated error", async () => {
    convexClient.mutation.mockRejectedValueOnce(new Error("backend exploded"));

    const { request, params } = makeSubmitRequest({
      answers: [{ questionId: "q1", questionText: "x", answerText: "y" }],
      inspirations: [],
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to submit" });
    expect(mockReportError).toHaveBeenCalledTimes(1);
  });
});
