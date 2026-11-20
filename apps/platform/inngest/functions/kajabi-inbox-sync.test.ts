import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({
  // Expose the handler so the test can drive it with a fake step runner.
  inngest: {
    createFunction: (
      _options: unknown,
      handler: (args: {
        step: { run: (name: string, fn: () => unknown) => unknown };
      }) => unknown
    ) => handler,
  },
}));

vi.mock("@/lib/observability", () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
}));

const { convexServerCall, FakeConvexServerCallError } = vi.hoisted(() => {
  class FakeConvexServerCallError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ConvexServerCallError";
      this.status = status;
    }
  }
  return {
    convexServerCall: vi.fn(),
    FakeConvexServerCallError,
  };
});

vi.mock("@/lib/convex-server-call", () => ({
  convexServerCall,
  ConvexServerCallError: FakeConvexServerCallError,
}));

import { kajabiInboxSync } from "./kajabi-inbox-sync";

const SUBJECT =
  "Congratulations! New purchase for 'Neil Gray - (1-on-1) Mentorship '";

/**
 * Inngest memoises `step.run`; running the callback inline is enough to
 * exercise the handler's control flow.
 */
function inlineStep() {
  return {
    run: (_name: string, fn: () => unknown) => fn(),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Mail = { id: string; text?: string | null; html?: string | null };

/** Stub Resend's list + detail endpoints with the given received mail. */
function mockInbox(mails: Mail[]): void {
  const list = mails.map((mail) => ({
    id: mail.id,
    subject: SUBJECT,
    from: "forwarder@example.com",
  }));
  const byId = new Map(
    mails.map((mail) => [
      mail.id,
      {
        id: mail.id,
        subject: SUBJECT,
        from: "forwarder@example.com",
        text: mail.text ?? null,
        html: mail.html ?? null,
      },
    ])
  );

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const detailMatch = url.match(/\/emails\/receiving\/([^?]+)/);
      if (detailMatch) {
        return jsonResponse(byId.get(detailMatch[1]) ?? {});
      }
      return jsonResponse({ data: list });
    })
  );
}

const REAL_BODY =
  "Name: Real Student\nEmail: real@example.com\nPurchase ID: 123456789";

describe("kajabiInboxSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    convexServerCall.mockReset();
    process.env.RESEND_API_KEY = "test-key";
    process.env.KAJABI_INBOX_RECEIVING_ADDRESS = "support@huckleberry.art";
  });

  it("skips a subject-only message instead of sending an empty rawText", async () => {
    mockInbox([
      { id: "email-bodyless", text: "   ", html: null },
      { id: "email-real", text: REAL_BODY },
    ]);
    convexServerCall.mockResolvedValue({ success: true, inserted: true });

    const result = (await (kajabiInboxSync as any)({
      step: inlineStep(),
    })) as { candidates: number; inserted: number; skipped: number };

    expect(result.candidates).toBe(2);
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);

    const upserts = convexServerCall.mock.calls.filter(
      (call) => call[0] === "/kajabi-purchase-inbox/upsert"
    );
    expect(upserts).toHaveLength(1);
    const payload = upserts[0][1] as { resendEmailId: string; rawText: string };
    expect(payload.resendEmailId).toBe("email-real");
    expect(payload.rawText.trim().length).toBeGreaterThan(0);
  });

  it("keeps processing after a message the endpoint permanently rejects", async () => {
    mockInbox([
      { id: "email-rejected", text: REAL_BODY },
      { id: "email-accepted", text: REAL_BODY },
    ]);
    convexServerCall
      .mockRejectedValueOnce(
        new FakeConvexServerCallError("Convex HTTP 400: rawText is required", 400)
      )
      .mockResolvedValueOnce({ success: true, inserted: true });

    const result = (await (kajabiInboxSync as any)({
      step: inlineStep(),
    })) as { inserted: number; skipped: number };

    // The 400 is a skipped message, not a fatal batch failure.
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("rethrows a 5xx so Inngest retries the step", async () => {
    mockInbox([{ id: "email-outage", text: REAL_BODY }]);
    convexServerCall.mockRejectedValue(
      new FakeConvexServerCallError("Convex HTTP 503", 503)
    );

    await expect(
      (kajabiInboxSync as any)({ step: inlineStep() })
    ).rejects.toThrow(/503/);
  });
});
