/**
 * HUC-94 — Route tests for /api/onboarding/[id]/questionnaire.
 *
 * Two methods on this route:
 *   - GET  hydrates the form (gets the current draft + the work-example
 *          list so the same fetch can rehydrate both).
 *   - PATCH auto-saves a draft, debounced client-side. Reads the same
 *          canonical `questionText` list the form uses so the server
 *          doesn't trust arbitrary client text.
 *
 * Greptile history has multiple P1s where the validator surface drifted
 * (missing `questionText`, wrong type on `clientSaveId`, missing
 * `questionnaireVersion`). These tests pin:
 *
 *   - 401 on missing auth.
 *   - 400 on body missing the Zod-required fields.
 *   - Stamping of `questionnaireVersion` from the constant — not the
 *     client.
 *   - Stamping of `questionText` per answer — same logic as the
 *     abandoned beacon, ensures PATCH does not regress.
 *   - 500 path on non-auth Convex errors.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { auth } from "@clerk/nextjs/server";

import { GET, PATCH } from "./route";
import { makeRequest } from "tests/unit/api-route-utils";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { reportError } from "@/lib/observability";
import { ForbiddenError } from "@/lib/errors";
import { ONBOARDING_QUESTIONNAIRE_VERSION } from "@/lib/workspace-constants";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/convex", () => ({
  getAuthenticatedConvexClient: vi.fn(),
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


const onboardingId = "ab1234567890"; // ≥10 chars, convexIdSchema-valid

describe("GET /api/onboarding/[id]/questionnaire", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_student_alice" } as any);
    mockGetAuthenticatedConvexClient.mockResolvedValue(convexClient);
    // `getQuestionnaireForCurrentUser` returns `null` when there is
    // no submission yet (the real return type is `v.null() |
    // v.object({...})`). Default to null so the 200 path uses
    // `mockResolvedValueOnce(...)` below.
    convexClient.query.mockResolvedValue(null);
  });

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce({ userId: null } as any);

    const request = makeRequest({
      method: "GET",
      url: `https://platform.test/api/onboarding/${onboardingId}/questionnaire`,
    });
    const response = await GET(request, {
      params: Promise.resolve({ id: onboardingId }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    // Don't issue Convex queries for unauth callers.
    expect(convexClient.query).not.toHaveBeenCalled();
  });

  it("returns {submission, workExamples} when the viewer is the assigned student", async () => {
    // Matches the REAL return shape of
    // `getQuestionnaireForCurrentUser`: a `submissionId`-keyed
    // object with the canonical fields. Greptile round-5 P2 #1:
    // the previous mock used an `_id` field the production
    // validator rejects, so this test would never have caught a
    // shape change.
    const submission = {
      submissionId: "sub_1",
      status: "draft" as const,
      questionnaireVersion: ONBOARDING_QUESTIONNAIRE_VERSION,
      answers: [],
      inspirations: [],
      updatedAt: 1234567890,
    };
    // Matches the REAL return shape of `listWorkExamples`.
    const workExamples = [
      {
        _id: "we_1",
        status: "active" as const,
        fileName: "photo.jpg",
        b2Key: "onboarding/uploads/abc/photo.jpg",
        contentType: "image/jpeg",
        size: 4096,
        uploadedAt: 1234567890,
      },
    ];
    convexClient.query
      .mockResolvedValueOnce(submission)
      .mockResolvedValueOnce(workExamples);

    const request = makeRequest({
      method: "GET",
      url: `https://platform.test/api/onboarding/${onboardingId}/questionnaire`,
    });
    const response = await GET(request, {
      params: Promise.resolve({ id: onboardingId }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ submission, workExamples });
    // Both queries should fire on this route.
    expect(convexClient.query).toHaveBeenCalledTimes(2);
    const [ref1, args1] = convexClient.query.mock.calls[0] as [any, any];
    expect(fnName(ref1)).toContain("getQuestionnaireForCurrentUser");
    expect(args1).toEqual({ onboardingId });
    const [ref2, args2] = convexClient.query.mock.calls[1] as [any, any];
    expect(fnName(ref2)).toContain("listWorkExamples");
    expect(args2).toEqual({ onboardingId });
  });


  it("returns 401 when Convex rejects with a Forbidden error (signed-in denial)", async () => {
    // The route's catch block matches both `isUnauthorizedError` AND
    // `isForbiddenError` to the same 401 response — a signed-in user
    // who fails the per-onboarding ownership check should get the
    // SAME body as an unauthenticated caller, not a 500 that leaks
    // the deny via `reportError`. Without this case, a future
    // refactor that turns the deny branch into "report and 500"
    // would slip past this suite.
    // Throw a real ForbiddenError instance — the production
    // `isForbiddenError` helper matches via `instanceof`. A plain
    // `new Error("Forbidden: ...")` would not be matched (Greptile
    // round-3 P2 #1: the previous substring mock accepted phrases
    // production rejects).
    convexClient.query.mockRejectedValueOnce(
      new ForbiddenError("not your onboarding")
    );
    const request = makeRequest({ method: "GET", url: `https://platform.test/api/onboarding/${onboardingId}/questionnaire` });
    const params = Promise.resolve({ id: onboardingId });


    const response = await GET(request, { params });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    // The 401 path returns BEFORE the `reportError` call — a deny is
    // expected client behavior, not a server-side anomaly. Pin the
    // negative so a future refactor that adds reportError to the
    // deny path (potentially double-reporting) is caught.
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it("returns 500 when Convex throws a non-auth error", async () => {
    convexClient.query.mockRejectedValueOnce(new Error("backend boom"));

    const request = makeRequest({
      method: "GET",
      url: `https://platform.test/api/onboarding/${onboardingId}/questionnaire`,
    });
    const response = await GET(request, {
      params: Promise.resolve({ id: onboardingId }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to read questionnaire" });
    expect(mockReportError).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /api/onboarding/[id]/questionnaire", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_student_alice" } as any);
    mockGetAuthenticatedConvexClient.mockResolvedValue(convexClient);
    // `saveQuestionnaireDraft` returns the REAL canonical shape:
//   { submissionId, status, storedClientSaveId, accepted }.
// Greptile round-5 P2 #1: the previous mock used `_id` (a Convex
// internal field, not part of the public return validator) and
// dropped the `storedClientSaveId`/`accepted` fields, so a
// refactor that flipped either would silently pass through CI.
const draftMock: any = {
  submissionId: "sub_draft_1",
  status: "draft" as const,
  storedClientSaveId: 9097,
  accepted: true,
};
convexClient.mutation.mockResolvedValue(draftMock);
  });

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce({ userId: null } as any);

    const request = makeRequest({
      method: "PATCH",
      url: `https://platform.test/api/onboarding/${onboardingId}/questionnaire`,
      body: { answers: [], inspirations: [], clientSaveId: 9097 as any },
    });
    const response = await PATCH(request, {
      params: Promise.resolve({ id: onboardingId }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(convexClient.mutation).not.toHaveBeenCalled();
  });

  it("returns 400 when answers is missing", async () => {
    const request = makeRequest({
      method: "PATCH",
      url: `https://platform.test/api/onboarding/${onboardingId}/questionnaire`,
      body: { inspirations: [], clientSaveId: 9097 },
    });
    const response = await PATCH(request, {
      params: Promise.resolve({ id: onboardingId }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid request");
    expect(body.details).toBeDefined();
    expect(convexClient.mutation).not.toHaveBeenCalled();
  });

  it("returns 400 when clientSaveId is not a number", async () => {
    const request = makeRequest({
      method: "PATCH",
      url: `https://platform.test/api/onboarding/${onboardingId}/questionnaire`,
      body: {
        answers: [],
        inspirations: [],
        clientSaveId: "not-a-number",
      },
    });
    const response = await PATCH(request, {
      params: Promise.resolve({ id: onboardingId }),
    });
    expect(response.status).toBe(400);
  });

  it("forwards the autosave to saveQuestionnaireDraft with server-stamped questionText", async () => {
    const request = makeRequest({
      method: "PATCH",
      url: `https://platform.test/api/onboarding/${onboardingId}/questionnaire`,
      body: {
        answers: [
          { questionId: "how_did_you_hear", answerText: "Hello world" },
          { questionId: "goals", answerText: "Another answer" },
        ],
        inspirations: [{ name: "Matisse" }],
        clientSaveId: 9097,
      },
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: onboardingId }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      submission: {
        submissionId: "sub_draft_1",
        status: "draft",
        storedClientSaveId: 9097,
        accepted: true,
      },
    });

    expect(convexClient.mutation).toHaveBeenCalledTimes(1);
    const [ref, args] = convexClient.mutation.mock.calls[0] as [any, any];
    expect(fnName(ref)).toContain("saveQuestionnaireDraft");
    // The route stamps `questionnaireVersion` from the workspace
    // constant — not from the client. Pin the EXACT value (Greptile
    // round-3 P2: `toBeDefined` accepted wrong types/values).
    expect(args.questionnaireVersion).toBe(ONBOARDING_QUESTIONNAIRE_VERSION);
    // The route stamps `questionText` from `ONBOARDING_QUESTIONS` —
    // never the client-sent text.
    expect(args.answers).toHaveLength(2);
    for (const a of args.answers) {
      expect(a).toHaveProperty("questionId");
      expect(a).toHaveProperty("questionText");
      expect(a).toHaveProperty("answerText");
      expect(typeof a.questionText).toBe("string");
    }
    // Both `how_did_you_hear` and `goals` are real entries in
    // `ONBOARDING_QUESTIONS` (per `apps/platform/lib/onboarding-questions.ts`).
    // Their labels are stamped verbatim by the route — a previous
    // version of this test used synthetic `q1`/`q2` ids that
    // resolved to `""` (allowing a regression that swapped to
    // client-trust to slip past). Real ids + exact-label match
    // closes that seam.
    expect(args.answers[0]).toMatchObject({
      questionId: "how_did_you_hear",
      questionText: "How did you learn about this mentorship?",
    });
    expect(args.answers[1]).toMatchObject({
      questionId: "goals",
      questionText: "What are your goals with art and this mentorship?",
    });
    expect(args.inspirations).toEqual([{ name: "Matisse" }]);
    expect(args.clientSaveId).toBe(9097);
    // PATCH should NOT pass `force` — autosave only updates when
    // the client is the most recent writer. The closing-tab beacon
    // route is the only caller that passes `force`.
    expect(args.force).toBeUndefined();
  });


  it("returns 401 when Convex rejects with a Forbidden error (signed-in denial)", async () => {
    // The route's catch block matches both `isUnauthorizedError` AND
    // `isForbiddenError` to the same 401 response — a signed-in user
    // who fails the per-onboarding ownership check should get the
    // SAME body as an unauthenticated caller, not a 500 that leaks
    // the deny via `reportError`. Without this case, a future
    // refactor that turns the deny branch into "report and 500"
    // would slip past this suite.
    // Throw a real ForbiddenError instance — see the rationale on the
    // GET-side denial test above.
    convexClient.mutation.mockRejectedValueOnce(
      new ForbiddenError("not your onboarding")
    );
    const request = makeRequest({ method: "PATCH", url: `https://platform.test/api/onboarding/${onboardingId}/questionnaire`, body: { answers: [], inspirations: [], clientSaveId: 1 } });
    const params = Promise.resolve({ id: onboardingId });


    const response = await PATCH(request, { params });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    // The 401 path returns BEFORE the `reportError` call — a deny is
    // expected client behavior, not a server-side anomaly. Pin the
    // negative so a future refactor that adds reportError to the
    // deny path (potentially double-reporting) is caught.
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it("returns 500 on a non-auth Convex error", async () => {
    convexClient.mutation.mockRejectedValueOnce(new Error("boom"));
    const request = makeRequest({
      method: "PATCH",
      url: `https://platform.test/api/onboarding/${onboardingId}/questionnaire`,
      body: { answers: [], inspirations: [], clientSaveId: 1 },
    });
    const response = await PATCH(request, {
      params: Promise.resolve({ id: onboardingId }),
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to save draft" });
    expect(mockReportError).toHaveBeenCalledTimes(1);
  });
});
