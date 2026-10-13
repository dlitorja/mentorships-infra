/**
 * HUC-94 — Route tests for POST /api/onboarding/[id]/abandoned.
 *
 * The route is the tab-close beacon fired by the questionnaire form
 * on `beforeunload`. Its contract is intentionally lenient: an
 * unauthenticated request and an unparseable body both succeed with
 * `{ ok: true }` so a flaky network on close does not block the page
 * from unloading. Server-side errors are routed through
 * `reportError` so a regression shows up in logs.
 *
 * The Greptile history on this route is dominated by P1s on the
 * Zod ↔ Convex validator seam (the `saveQuestionnaireDraft`
 * mutation rejects when `questionText` is missing on answers).
 * These tests pin:
 *
 *   1. The beacon stays silent (200 + `{ok:true}`) on auth failure.
 *   2. An empty body still stamps `lastSeenAt` via
 *      `recordQuestionnaireSeen` without firing `saveQuestionnaireDraft`.
 *   3. A body with `answers` is forwarded to
 *      `saveQuestionnaireDraft` with the canonical `questionText`
 *      stamped per answer (server-side truth, not client-sent).
 *   4. `force: true` is always sent — the closing tab is the most
 *      recent activity source; the server's strict-greater-than
 *      guard must not drop its writes when another tab was the
 *      latest writer.
 *   5. Non-auth errors route through `reportError` and still return
 *      `{ ok: true }` (beacon is best-effort).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { auth } from "@clerk/nextjs/server";

import { POST } from "./route";
import { makeRequest } from "tests/unit/api-route-utils";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { reportError } from "@/lib/observability";
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


const onboardingId = "ab1234567890"; // matches convexIdSchema: 10+ alphanumeric/_/-

function makeBeaconRequest(body: object | undefined) {
  return {
    request: makeRequest({
      method: "POST",
      url: `https://platform.test/api/onboarding/${onboardingId}/abandoned`,
      body: body ?? {},
    }),
    params: Promise.resolve({ id: onboardingId }),
  };
}

describe("POST /api/onboarding/[id]/abandoned", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_student_alice" } as any);
    mockGetAuthenticatedConvexClient.mockResolvedValue(convexClient);
    convexClient.mutation.mockResolvedValue(undefined);
  });

  it("returns {ok:true} and skips Convex calls when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce({ userId: null } as any);

    const { request, params } = makeBeaconRequest({ answers: [{ questionId: "x" }] });
    const response = await POST(request, { params });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    // Beacon should not perform any Convex writes when unauth —
    // otherwise a flood of bot/abandoned requests would hit the DB.
    expect(convexClient.mutation).not.toHaveBeenCalled();
    expect(convexClient.query).not.toHaveBeenCalled();
    expect(convexClient.action).not.toHaveBeenCalled();
  });

  it("stamps lastSeenAt but skips saveDraft when body has no answers/inspirations", async () => {
    const { request, params } = makeBeaconRequest({});
    const response = await POST(request, { params });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    // Only recordQuestionnaireSeen should fire — saves are gated
    // on the client supplying `answers` or `inspirations`.
    expect(convexClient.mutation).toHaveBeenCalledTimes(1);
    const [calledRef, calledArgs] = convexClient.mutation.mock.calls[0] as [any, any];
    expect(fnName(calledRef)).toContain("recordQuestionnaireSeen");
    expect(calledArgs).toEqual({ onboardingId });
  });

  it("forwards answers to saveQuestionnaireDraft with questionText stamped server-side", async () => {
    const { request, params } = makeBeaconRequest({
      answers: [
        { questionId: "how_did_you_hear", answerText: "My answer" },
        { questionId: "unknown-id", answerText: "Another answer" },
      ],
      inspirations: [{ name: "Picasso" }],
      clientSaveId: 7,
    });

    const response = await POST(request, { params });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    // Expect TWO mutations: saveQuestionnaireDraft first, then
    // recordQuestionnaireSeen.
    expect(convexClient.mutation).toHaveBeenCalledTimes(2);

    const [draftRef, draftArgs] = convexClient.mutation.mock.calls[0] as [any, any];
    expect(fnName(draftRef)).toContain("saveQuestionnaireDraft");
    expect(draftArgs.onboardingId).toBe(onboardingId);
    expect(draftArgs.inspirations).toEqual([{ name: "Picasso" }]);
    expect(draftArgs.clientSaveId).toBe(7);
    // Greptile round-3 P2 #3: the beacon test never checked
    // `questionnaireVersion` although `saveQuestionnaireDraft`
    // requires it as a number. Pin the EXACT constant so removing
    // the field (or sending the wrong type) flips this to fail.
    expect(draftArgs.questionnaireVersion).toBe(
      ONBOARDING_QUESTIONNAIRE_VERSION
    );

    // The route stamps `questionText` from the canonical question
    // list (`ONBOARDING_QUESTIONS`) — never trust a client-supplied
    // value. Unknown ids get an empty `questionText` rather than the
    // raw string from the wire.
    expect(Array.isArray(draftArgs.answers)).toBe(true);
    expect(draftArgs.answers).toHaveLength(2);
    // Structure: each answer has the three Convex validator fields.
    for (const a of draftArgs.answers) {
      expect(a).toHaveProperty("questionId");
      expect(a).toHaveProperty("questionText");
      expect(a).toHaveProperty("answerText");
      expect(typeof a.questionText).toBe("string");
    }
    // `how_did_you_hear` is a real question in ONBOARDING_QUESTIONS;
    // its label is what the server stamps onto `questionText`. A
    // future refactor that flips this from a label lookup to a
    // client-trust would flip this assertion to fail.
    expect(draftArgs.answers[0].questionId).toBe("how_did_you_hear");
    expect(draftArgs.answers[0].answerText).toBe("My answer");
    // The server stamps the canonical label, NOT the client text.
    expect(draftArgs.answers[0].questionText).toBe(
      "How did you learn about this mentorship?"
    );

    // Beacon must send `force: true` — the closing tab wins ties
    // against other tabs that may have a higher `clientSaveId`.
    expect(draftArgs.force).toBe(true);

    // recordQuestionnaireSeen still runs after the save.
    const [seenRef, seenArgs] = convexClient.mutation.mock.calls[1] as [any, any];
    expect(fnName(seenRef)).toContain("recordQuestionnaireSeen");
    expect(seenArgs).toEqual({ onboardingId });
  });

  it("defaults clientSaveId to 0 when the body omits it", async () => {
    const { request, params } = makeBeaconRequest({
      answers: [{ questionId: "how_did_you_hear", answerText: "x" }],
    });

    const response = await POST(request, { params });
    expect(response.status).toBe(200);

    const [, draftArgs] = convexClient.mutation.mock.calls[0] as [any, any];
    expect(draftArgs.clientSaveId).toBe(0);
  });

  it("treats a malformed body as an empty beacon (does not 500)", async () => {
    // Send a request whose body is NOT parseable JSON. The route
    // intentionally catches parse failures and treats them as
    // empty beacons — a tab close mid-flight should not produce
    // a stack trace.
    const request = new Request(
      `https://platform.test/api/onboarding/${onboardingId}/abandoned`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ this is not valid JSON }",
      }
    ) as any;

    const response = await POST(request, {
      params: Promise.resolve({ id: onboardingId }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    // Empty-beacon path: only the seen-mutation fires, the save
    // is skipped because no `answers`/`inspirations` were parseable.
    const calls = convexClient.mutation.mock.calls as Array<[any, any]>;
    expect(calls.length).toBe(1);
    expect(fnName(calls[0][0])).toBe("onboardingQuestionnaire:recordQuestionnaireSeen");
  });

  it("routs non-auth errors through reportError and still returns {ok:true}", async () => {
    convexClient.mutation.mockRejectedValueOnce(
      new Error("Convex backend exploded")
    );

    const { request, params } = makeBeaconRequest({});
    const response = await POST(request, { params });

    // The beacon swallows everything that isn't auth-shaped so the
    // page can unload cleanly. A non-auth `Error` should not 500.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mockReportError).toHaveBeenCalledTimes(1);
  });
});
