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
    const { request, params } = makeUploadUrlRequest({
      fileName: "photo.jpg",
      contentType: "image/jpeg",
      size: 4096,
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
    // Required args from the route to the action — pin the keys.
    expect(Object.keys(args).sort()).toEqual(
      expect.arrayContaining([
        "contentType",
        "fileId",
        "fileName",
        "onboardingId",
        "size",
      ])
    );
    expect(args.onboardingId).toBe(onboardingId);
    expect(args.fileName).toBe("photo.jpg");
    expect(args.contentType).toBe("image/jpeg");
    expect(args.size).toBe(4096);
    // `fileId` is minted server-side as a UUID — the route MUST NOT
    // accept it from the wire. Pin that the value is well-formed.
    expect(typeof args.fileId).toBe("string");
    expect(args.fileId.length).toBeGreaterThan(0);
    // Greptile P1 #4: the action computes the B2 key prefix
    // internally — the route MUST NOT pass any `key`/`b2Key`/
    // `prefix`-shaped field the client could use to write outside
    // the `onboarding/` namespace.
    for (const forbidden of ["key", "b2Key", "prefix", "keyPrefix"]) {
      expect((args as any)[forbidden]).toBeUndefined();
    }
  });

  it("returns 422 when the action rejects with a capacity-style message", async () => {
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
