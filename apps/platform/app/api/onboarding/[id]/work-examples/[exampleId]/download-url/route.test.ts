/**
 * HUC-94 — Route tests for GET
 * `/api/onboarding/[id]/work-examples/[exampleId]/download-url`.
 *
 * Mints a short-lived presigned GET URL for an instructor or admin to
 * view a student's work example. The action
 * `getWorkExampleDownloadUrl` takes a `b2Key` rather than a
 * `workExampleId` — the resolving `workExampleId → b2Key` round trip
 * is what guards against a forged key writing outside the
 * `onboarding/` namespace.
 *
 * Greptile history on this seam:
 *   - early revision of this route handed the `workExampleId`
 *     straight to the action. The action's `args` validator then
 *     threw, leaking the validator shape to the client. Pin that
 *     the route resolves the row first.
 *   - the resolver returns `null` when forbidden / not-found. The
 *     route should NOT 500 in that case — surface 404 so the page
 *     can render a "not found" state.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { auth } from "@clerk/nextjs/server";

import { GET } from "./route";
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
const workExampleId = "wx12345678901";

function makeDownloadRequest(workableId: string = workExampleId) {
  return {
    request: makeRequest({
      method: "GET",
      url: `https://platform.test/api/onboarding/${onboardingId}/work-examples/${workableId}/download-url`,
    }),
    params: Promise.resolve({ id: onboardingId, exampleId: workableId }),
  };
}

describe("GET /api/onboarding/[id]/work-examples/[exampleId]/download-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_instructor_eve" } as any);
    mockGetAuthenticatedConvexClient.mockResolvedValue(convexClient);
  });

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce({ userId: null } as any);
    const { request, params } = makeDownloadRequest();
    const response = await GET(request, { params });
    expect(response.status).toBe(401);
    expect(convexClient.query).not.toHaveBeenCalled();
    expect(convexClient.action).not.toHaveBeenCalled();
  });

  it("returns 404 when the work-example row resolves to null (forbidden / missing)", async () => {
    convexClient.query.mockResolvedValueOnce(null);

    const { request, params } = makeDownloadRequest();
    const response = await GET(request, { params });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    // No action call should be made when the resolve is null —
    // otherwise we'd be running an unauthenticated B2 read.
    expect(convexClient.action).not.toHaveBeenCalled();
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it("resolves the row, then mints the download URL via the action with {onboardingId, b2Key}", async () => {
    convexClient.query.mockResolvedValueOnce({
      _id: workExampleId,
      b2Key: "onboarding/uploads/abcdef/photo.jpg",
    });
    convexClient.action.mockResolvedValueOnce({
      downloadUrl: "https://b2.example.com/dl?token=abc",
      expiresAt: 1234567890,
    });

    const { request, params } = makeDownloadRequest();
    const response = await GET(request, { params });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      downloadUrl: "https://b2.example.com/dl?token=abc",
      expiresAt: 1234567890,
    });

    // Two-step: 1) resolve via query, 2) mint via action.
    expect(convexClient.query).toHaveBeenCalledTimes(1);
    expect(convexClient.action).toHaveBeenCalledTimes(1);

    const [qRef, qArgs] = convexClient.query.mock.calls[0] as [any, any];
    expect(fnName(qRef)).toContain("getWorkExampleByIdForViewer");
    expect(qArgs.onboardingId).toBe(onboardingId);
    expect(qArgs.workExampleId).toBe(workExampleId);

    const [aRef, aArgs] = convexClient.action.mock.calls[0] as [any, any];
    expect(fnName(aRef)).toContain("getWorkExampleDownloadUrl");
    // Pin the arg shape: the action takes `{onboardingId, b2Key}`
    // — NOT `{onboardingId, workExampleId}` (the early Greptile P1).
    expect(Object.keys(aArgs).sort()).toEqual(
      expect.arrayContaining(["b2Key", "onboardingId"])
    );
    expect(aArgs.onboardingId).toBe(onboardingId);
    expect(aArgs.b2Key).toBe("onboarding/uploads/abcdef/photo.jpg");
    expect(aArgs.workExampleId).toBeUndefined();
  });

  it("returns 500 on an unrelated Convex error in the resolve or mint", async () => {
    convexClient.query.mockRejectedValueOnce(new Error("lookup failed"));
    const { request, params } = makeDownloadRequest();
    const response = await GET(request, { params });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to mint download URL" });
    expect(mockReportError).toHaveBeenCalledTimes(1);
  });
});
