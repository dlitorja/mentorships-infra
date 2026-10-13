/**
 * HUC-94 — Route tests for POST /api/onboarding/[id]/work-examples/upload-url.
 *
 * Mints a presigned PUT URL for a work-example image upload. The
 * action `generateWorkExampleUploadUrl` returns BOTH the URL and the
 * reserved `workExampleId` — the client PUTs to B2 with that URL,
 * then calls `/work-examples` POST with the id to flip the row from
 * `pending` → `active`.
 *
 * Greptile history on this seam:
 *
 *   - The B2 key prefix is computed server-side inside the action —
 *     passing it from the wire would let a forged client write
 *     outside the `onboarding/` namespace. The route MUST NOT
 *     accept `key`/`b2Key`/`prefix` from the request body.
 *   - mime + size are validated at the API boundary so a forged
 *     client can't request an upload that the action would have
 *     to reject (saves a wasted PUT round-trip).
 *   - Capacity errors are surfaced as 422 (semantic client error)
 *     instead of 500 so the form can render specific copy.
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

function makeUploadUrlRequest(body: object) {
  return {
    request: makeRequest({
      method: "POST",
      url: `https://platform.test/api/onboarding/${onboardingId}/work-examples/upload-url`,
      body,
    }),
    params: Promise.resolve({ id: onboardingId }),
  };
}

describe("POST /api/onboarding/[id]/work-examples/upload-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_student_alice" } as any);
    mockGetAuthenticatedConvexClient.mockResolvedValue(convexClient);
    // Action returns the canonical shape: a URL + a reserved workExampleId.
    convexClient.action.mockResolvedValue({
      uploadUrl: "https://b2.example.com/upload-url",
      workExampleId: "wx12345678901",
    });
  });

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce({ userId: null } as any);
    const { request, params } = makeUploadUrlRequest({
      fileName: "photo.jpg",
      contentType: "image/jpeg",
      size: 4096,
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(401);
    expect(convexClient.action).not.toHaveBeenCalled();
  });

  it("returns 400 when contentType is not an allowed image mime", async () => {
    const { request, params } = makeUploadUrlRequest({
      fileName: "doc.pdf",
      contentType: "application/pdf",
      size: 4096,
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(400);
    expect(convexClient.action).not.toHaveBeenCalled();
  });

  it("returns 400 when size exceeds the 8 MB ceiling", async () => {
    const { request, params } = makeUploadUrlRequest({
      fileName: "huge.jpg",
      contentType: "image/jpeg",
      size: 9 * 1024 * 1024,
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(400);
    expect(convexClient.action).not.toHaveBeenCalled();
  });

  it("returns 400 when fileName is empty", async () => {
    const { request, params } = makeUploadUrlRequest({
      fileName: "",
      contentType: "image/jpeg",
      size: 4096,
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(400);
  });

  it("forwards a server-generated fileId to generateWorkExampleUploadUrl", async () => {
    // Greptile round-2 P2 #1: previous version of this test sent a
    // request without `fileId`, then asserted the route's forwarded
    // `args.fileId` was a non-empty string. That would still pass if
    // a future refactor started using a client-supplied `fileId`
    // with a server-generated fallback (or stripped the randomUUID
    // call entirely). The fix is to send a known-bad client fileId
    // alongside all the other fields the route MUST reject, and
    // assert the route's forwarded args ignore all of them.
    const clientFileId = "client-chosen-id-attacker-supplied";
    const clientEvilKey = "../escape-the-namespace";
    const clientEvilPrefix = "../../etc-passwd";
    const { request, params } = makeUploadUrlRequest({
      fileName: "photo.jpg",
      contentType: "image/jpeg",
      size: 4096,
      fileId: clientFileId,
      key: clientEvilKey,
      b2Key: clientEvilKey,
      prefix: clientEvilPrefix,
      keyPrefix: clientEvilPrefix,
    });
    const response = await POST(request, { params });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      uploadUrl: "https://b2.example.com/upload-url",
      workExampleId: "wx12345678901",
    });

    expect(convexClient.action).toHaveBeenCalledTimes(1);
    const [ref, args] = convexClient.action.mock.calls[0] as [any, any];
    expect(fnName(ref)).toContain("generateWorkExampleUploadUrl");
    // Required args from the route to the action — pin EXACT keys
    // (Greptile round-1 P2 #3: `expect.arrayContaining` allowed
    // extras — we want to know the full forwarded shape).
    expect(Object.keys(args).sort()).toEqual(
      ["contentType", "fileId", "fileName", "onboardingId", "size"]
    );
    expect(args.onboardingId).toBe(onboardingId);
    expect(args.fileName).toBe("photo.jpg");
    expect(args.contentType).toBe("image/jpeg");
    expect(args.size).toBe(4096);
    // `fileId` is minted server-side as a UUID — any future refactor
    // that accepts the client's fileId will FAIL here because
    // `client-supplied-id-attacker-supplied` is not a UUID.
    expect(args.fileId).not.toBe(clientFileId);
    expect(typeof args.fileId).toBe("string");
    expect(args.fileId.length).toBeGreaterThan(0);
    // Greptile round-1 P1 #4: the action computes the B2 key prefix
    // internally — the route MUST NOT pass any `key`/`b2Key`/
    // `prefix`-shaped field the client could use to write outside
    // the `onboarding/` namespace. Sending them through the body
    // and asserting they're absent in `args` makes the guard
    // bidirectional (and the same inputs serve as the canary).
    for (const forbiddenField of [
      ["key", clientEvilKey],
      ["b2Key", clientEvilKey],
      ["prefix", clientEvilPrefix],
      ["keyPrefix", clientEvilPrefix],
    ] as const) {
      expect((args as any)[forbiddenField[0]]).toBeUndefined();
    }
  });

  it("returns 422 when the action rejects with a message matching the regex's 'too many' branch", async () => {
    // Verify the route's regex (`/capacity|limit|too large|too many/i`)
    // catches the substring and surfaces the body verbatim at 422.
    // This string is a substring test fixture, NOT a real backend
    // message — see the next test for that.
    convexClient.action.mockRejectedValueOnce(
      new Error("too many work examples for this onboarding (capacity exceeded)")
    );

    const { request, params } = makeUploadUrlRequest({
      fileName: "photo.jpg",
      contentType: "image/jpeg",
      size: 4096,
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "too many work examples for this onboarding (capacity exceeded)",
    });
    // The 422 semantic-client-error branch returns before the
    // `reportError` call — a capacity rejection is the form's
    // expected recovery state, not a server-side anomaly. If a
    // future refactor flips this to include reportError the next
    // test will catch it.
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it("returns 500 (not 422) when the action throws the REAL 'At most N work examples' message — known regex-coverage gap (Greptile round-2)", async () => {
    // The actual Convex action throws
    //   `At most ${MAX_WORK_EXAMPLES_PER_ONBOARDING} work examples per onboarding`
    // at `convex/onboardingWorkExamplesActions.ts`. None of
    // "capacity", "limit", "too large", or "too many" appear in
    // that string — production falls through to the generic 500
    // branch instead of returning a 422 the form can recovery
    // from. This test pins CURRENT behavior (a known gap, out of
    // scope for the test-scaffolding PR) so a future fix that
    // either widens the regex or threads a structured ConvexError
    // signal through the action surfaces as either a passing
    // assertion here (fix landed) or a deliberate test edit.
    convexClient.action.mockRejectedValueOnce(
      new Error("At most 6 work examples per onboarding")
    );

    const { request, params } = makeUploadUrlRequest({
      fileName: "photo.jpg",
      contentType: "image/jpeg",
      size: 4096,
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to mint upload URL" });
  });


  it("returns 401 when Convex rejects with a Forbidden error (signed-in denial)", async () => {
    // The route's catch block matches both `isUnauthorizedError` AND
    // `isForbiddenError` to the same 401 response — a signed-in user
    // who fails the per-onboarding ownership check should get the
    // SAME body as an unauthenticated caller, not a 500 that leaks
    // the deny via `reportError`. Without this case, a future
    // refactor that turns the deny branch into "report and 500"
    // would slip past this suite.
    convexClient.action.mockRejectedValueOnce(
      new Error("Forbidden: not your onboarding")
    );
    const { request, params } = makeUploadUrlRequest({ fileName: "photo.jpg", contentType: "image/jpeg", size: 4096 });


    const response = await POST(request, { params });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    // The 401 path returns BEFORE the `reportError` call — a deny is
    // expected client behavior, not a server-side anomaly. Pin the
    // negative so a future refactor that adds reportError to the
    // deny path (potentially double-reporting) is caught.
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it("returns 500 on an unrelated Convex error", async () => {
    convexClient.action.mockRejectedValueOnce(new Error("backend exploded"));
    const { request, params } = makeUploadUrlRequest({
      fileName: "photo.jpg",
      contentType: "image/jpeg",
      size: 4096,
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to mint upload URL" });
    expect(mockReportError).toHaveBeenCalledTimes(1);
  });
});
