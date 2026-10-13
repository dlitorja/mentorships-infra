/**
 * HUC-94 — Route tests for DELETE /api/onboarding/[id]/work-examples/[exampleId].
 *
 * Removes an uploaded work example. Two adjacent ids: the onboarding
 * id from the URL + the work-example id. Both are routed through
 * `convexIdSchema.parse` to surface malformed ids as a stable
 * validation error rather than a 500.
 *
 * Greptile history on this seam:
 *   - the work-example id was once dropped on the server side, which
 *     let a malicious or buggy client delete the wrong row. These
 *     tests pin that BOTH ids are forwarded to the mutation.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { auth } from "@clerk/nextjs/server";

import { DELETE } from "./route";
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

function makeDeleteRequest(workableId: string = workExampleId) {
  return {
    request: makeRequest({
      method: "DELETE",
      url: `https://platform.test/api/onboarding/${onboardingId}/work-examples/${workableId}`,
    }),
    params: Promise.resolve({ id: onboardingId, exampleId: workableId }),
  };
}

describe("DELETE /api/onboarding/[id]/work-examples/[exampleId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_student_alice" } as any);
    mockGetAuthenticatedConvexClient.mockResolvedValue(convexClient);
    // `deleteWorkExample` returns `null` (the production return
    // validator is `v.null()`). Greptile round-5 P2 #1: the
    // previous mock used `{ ok: true }` — a fabricated field
    // passed back to the client as the JSON response body.
    convexClient.mutation.mockResolvedValue(null);
  });

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce({ userId: null } as any);
    const { request, params } = makeDeleteRequest();
    const response = await DELETE(request, { params });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(convexClient.mutation).not.toHaveBeenCalled();
  });

  it("returns 500-class path when the workExampleId is malformed", async () => {
    // The route catches Zod-parse failures via the generic catch
    // block. Since `isUnauthorizedError` returns false on a ZodError
    // (the message doesn't include "Unauthorized"), the route
    // reports the error and returns a 500. Pin that behaviour so
    // a future refactor doesn't accidentally surface it as 401.
    const { request, params } = makeDeleteRequest("!");
    const response = await DELETE(request, { params });
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(convexClient.mutation).not.toHaveBeenCalled();
    expect(mockReportError).toHaveBeenCalled();
  });

  it("forwards BOTH ids to deleteWorkExample", async () => {
    const { request, params } = makeDeleteRequest();
    const response = await DELETE(request, { params });

    // `deleteWorkExample` returns `null`. The route forwards the
    // convex return value verbatim via `NextResponse.json(result)`,
    // so the JSON response body is also `null`.
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();

    expect(convexClient.mutation).toHaveBeenCalledTimes(1);
    const [ref, args] = convexClient.mutation.mock.calls[0] as [any, any];
    expect(fnName(ref)).toContain("deleteWorkExample");
    // The `args.validator` for `deleteWorkExample` declares exactly
    // these two keys — pin both so a future drift on either side
    // fails CI.
    expect(Object.keys(args).sort()).toEqual(
      ["onboardingId", "workExampleId"]
    );
    expect(args.onboardingId).toBe(onboardingId);
    expect(args.workExampleId).toBe(workExampleId);
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
    convexClient.mutation.mockRejectedValueOnce(
      new ForbiddenError("not your onboarding")
    );
    const { request, params } = makeDeleteRequest();


    const response = await DELETE(request, { params });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    // The 401 path returns BEFORE the `reportError` call — a deny is
    // expected client behavior, not a server-side anomaly. Pin the
    // negative so a future refactor that adds reportError to the
    // deny path (potentially double-reporting) is caught.
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it("returns 500 on a non-auth Convex error", async () => {
    convexClient.mutation.mockRejectedValueOnce(
      new Error("row already deleted")
    );
    const { request, params } = makeDeleteRequest();
    const response = await DELETE(request, { params });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to delete work example" });
    expect(mockReportError).toHaveBeenCalledTimes(1);
  });
});
