/**
 * HUC-94 — Route tests for POST /api/onboarding/[id]/work-examples.
 *
 * The client PUT the bytes to B2 using the URL from `/upload-url`.
 * This route tells Convex to flip the row from `pending` → `active`
 * via the action `recordWorkExampleUpload`. The body carries the
 * reserved `workExampleId` returned at upload-url time.
 *
 * Greptile P1 history on this seam:
 *   - early draft leaked `fileId` from the wire (the server already
 *     has it from upload-url time, so re-passing just invites bugs).
 *   - matching the Zod schema fields to the action's `args` is the
 *     foremost source of regressions. These tests pin the exact
 *     arg shape so a future drift on either side fails CI.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { auth } from "@clerk/nextjs/server";

import { POST } from "./route";
import { makeRequest } from "tests/unit/api-route-utils";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { reportError } from "@/lib/observability";
import { ForbiddenError } from "@/lib/errors";

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


const onboardingId = "ab1234567890";
const workExampleId = "wx12345678901";

function makeRecordRequest(body: object) {
  return {
    request: makeRequest({
      method: "POST",
      url: `https://platform.test/api/onboarding/${onboardingId}/work-examples`,
      body,
    }),
    params: Promise.resolve({ id: onboardingId }),
  };
}

describe("POST /api/onboarding/[id]/work-examples", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_student_alice" } as any);
    mockGetAuthenticatedConvexClient.mockResolvedValue(convexClient);
    convexClient.action.mockResolvedValue({ ok: true, status: "active" });
  });

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce({ userId: null } as any);
    const { request, params } = makeRecordRequest({ workExampleId });
    const response = await POST(request, { params });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(convexClient.action).not.toHaveBeenCalled();
  });

  it("returns 400 when workExampleId is missing", async () => {
    const { request, params } = makeRecordRequest({});
    const response = await POST(request, { params });
    expect(response.status).toBe(400);
    expect(convexClient.action).not.toHaveBeenCalled();
  });

  it("returns 400 when workExampleId is malformed", async () => {
    const { request, params } = makeRecordRequest({ workExampleId: "!" });
    const response = await POST(request, { params });
    expect(response.status).toBe(400);
  });

  it("calls recordWorkExampleUpload with exactly {onboardingId, workExampleId}", async () => {
    const { request, params } = makeRecordRequest({ workExampleId });
    const response = await POST(request, { params });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "active" });

    expect(convexClient.action).toHaveBeenCalledTimes(1);
    const [ref, args] = convexClient.action.mock.calls[0] as [any, any];
    expect(fnName(ref)).toContain("recordWorkExampleUpload");
    // Pin the arg shape — both keys are required by the action's
    // `args` validator, no extras, no missing.
    expect(Object.keys(args).sort()).toEqual(
      ["onboardingId", "workExampleId"]
    );
    expect(args.onboardingId).toBe(onboardingId);
    expect(args.workExampleId).toBe(workExampleId);
    // Greptile P1 #4: the route MUST NOT pass `fileId` — the
    // action already knows it from the upload-url reservation. If
    // a future refactor accepts it from the wire, the B2 key prefix
    // could be spoofed to write outside the `onboarding/` namespace.
    expect(args.fileId).toBeUndefined();
  });


  it("returns 401 when Convex rejects with a Forbidden error (signed-in denial)", async () => {
    // The route's catch block matches both `isUnauthorizedError` AND
    // `isForbiddenError` to the same 401 response — a signed-in user
    // who fails the per-onboarding ownership check should get the
    // SAME body as an unauthenticated caller, not a 500 that leaks
    // the deny via `reportError`. Without this case, a future
    // refactor that turns the deny branch into "report and 500"
    // would slip past this suite.
    // Throw a real ForbiddenError instance — see the rationale on
    // download-url/route.test.ts.
    convexClient.action.mockRejectedValueOnce(
      new ForbiddenError("not your onboarding")
    );
    const { request, params } = makeRecordRequest({ workExampleId });


    const response = await POST(request, { params });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    // The 401 path returns BEFORE the `reportError` call — a deny is
    // expected client behavior, not a server-side anomaly. Pin the
    // negative so a future refactor that adds reportError to the
    // deny path (potentially double-reporting) is caught.
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it("returns 500 on a non-auth Convex error", async () => {
    convexClient.action.mockRejectedValueOnce(new Error("B2 write failed"));
    const { request, params } = makeRecordRequest({ workExampleId });
    const response = await POST(request, { params });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to record upload" });
    expect(mockReportError).toHaveBeenCalledTimes(1);
  });
});
