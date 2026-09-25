import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeRequest } from "../../../../../../tests/unit/api-route-utils";

vi.mock("@/lib/inngest", () => ({
  inngest: {
    send: vi.fn().mockResolvedValue({ ids: ["evt_test_1"] }),
  },
}));

vi.mock("@/lib/convex-server-call", () => ({
  convexServerCall: vi.fn(),
  ConvexServerCallError: class ConvexServerCallError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ConvexServerCallError";
      this.status = status;
    }
  },
}));

vi.mock("@/lib/observability", () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
  reportInfo: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ratelimit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ratelimit")>("@/lib/ratelimit");
  return {
    ...actual,
    protectWithRateLimit: vi.fn(),
  };
});

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  // `after` from next/server requires a real request context
  // and throws outside it. In tests we use a no-op so the
  // observed emissions are still verifiable via the existing
  // `vi.mocked(reportError)` assertions.
  return {
    ...actual,
    after: (callback: () => unknown) => callback(),
  };
});

import { protectWithRateLimit } from "@/lib/ratelimit";
import { convexServerCall, ConvexServerCallError } from "@/lib/convex-server-call";

const URL = "https://huckleberry-drive.example.com/api/webhooks/kajabi";

function makeKajabiPayload(overrides: Record<string, unknown> = {}) {
  return {
    event: "purchase.created",
    offer: { id: "off_test_123", title: "Test Offer" },
    member: { email: "buyer@example.com", name: "Test Buyer" },
    transaction: { id: "tx_test_abc", quantity: 1 },
    ...overrides,
  };
}

describe("Kajabi webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(protectWithRateLimit).mockReset();
    vi.mocked(convexServerCall).mockReset();
  });

  describe("rate-limit integration", () => {
    it("does NOT call protectWithRateLimit itself (proxy is the single charge point)", async () => {
      // The proxy already applies the `webhook` policy before this
      // handler runs. If the handler called it again, the same IP
      // bucket would be incremented twice per request, doubling the
      // effective limit and 429'ing legitimate bursts earlier than
      // intended. This test guards against that regression.
      vi.mocked(convexServerCall)
        .mockResolvedValueOnce({ success: true, mapping: null })
        .mockResolvedValueOnce({ success: true, alreadyApplied: false, newValue: 4, oldValue: 5 });

      const request = makeRequest({
        method: "POST",
        url: URL,
        body: makeKajabiPayload(),
        headers: { "user-agent": "Kajabi-Webhook/1.0" },
      });

      const { POST } = await import("@/app/api/webhooks/kajabi/route");
      await POST(request);
      expect(vi.mocked(protectWithRateLimit)).not.toHaveBeenCalled();
    });
  });

  describe("User-Agent validation", () => {
    it("returns 400 when User-Agent is missing or doesn't contain 'Kajabi'", async () => {
      const request = makeRequest({
        method: "POST",
        url: URL,
        body: makeKajabiPayload(),
        headers: { "user-agent": "curl/7.79.1" },
      });

      const { POST } = await import("@/app/api/webhooks/kajabi/route");
      const response = await POST(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(/Invalid request/i);
    });

    it("includes the source IP in the reportError context for invalid-UA rejections", async () => {
      const reportError = (await import("@/lib/observability")).reportError;

      const request = makeRequest({
        method: "POST",
        url: URL,
        body: makeKajabiPayload(),
        headers: {
          "user-agent": "curl/7.79.1",
          "x-vercel-forwarded-for": "203.0.113.42",
        },
      });

      const { POST } = await import("@/app/api/webhooks/kajabi/route");
      await POST(request);

      expect(vi.mocked(reportError)).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "webhooks/kajabi",
          level: "warn",
          context: expect.objectContaining({
            userAgent: "curl/7.79.1",
            offerId: "off_test_123",
            ip: "203.0.113.42",
          }),
        }),
      );
    });

    it("uses Vercel's trusted edge header (x-vercel-forwarded-for) over spoofable client headers", async () => {
      // Greptile P1: a caller-supplied x-forwarded-for / cf-connecting-ip
      // is spoofable, so per-IP alerts would not reliably identify a
      // burst. Vercel strips the client-supplied portion before setting
      // x-vercel-forwarded-for, so that header is the trusted one and
      // must take precedence over the spoofable headers.
      const reportError = (await import("@/lib/observability")).reportError;

      const request = makeRequest({
        method: "POST",
        url: URL,
        body: makeKajabiPayload(),
        headers: {
          "user-agent": "curl/7.79.1",
          "x-vercel-forwarded-for": "203.0.113.42",
          "cf-connecting-ip": "198.51.100.7",
          "x-forwarded-for": "198.51.100.7, 10.0.0.1",
          "x-real-ip": "198.51.100.7",
        },
      });

      const { POST } = await import("@/app/api/webhooks/kajabi/route");
      await POST(request);

      expect(vi.mocked(reportError)).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "webhooks/kajabi",
          level: "warn",
          context: expect.objectContaining({ ip: "203.0.113.42" }),
        }),
      );
      const call = vi.mocked(reportError).mock.calls.find(
        (c) =>
          c[0]?.source === "webhooks/kajabi" &&
          c[0]?.context?.ip === "203.0.113.42",
      );
      expect(call).toBeDefined();
      expect(call![0].context?.ip).not.toBe("198.51.100.7");
    });

    it("accepts a User-Agent containing 'Kajabi' (case-insensitive)", async () => {
      vi.mocked(convexServerCall)
        .mockResolvedValueOnce({ success: true, mapping: null })
        .mockResolvedValueOnce({ success: true, alreadyApplied: false, newValue: 4, oldValue: 5 });

      const request = makeRequest({
        method: "POST",
        url: URL,
        body: makeKajabiPayload(),
        headers: { "user-agent": "kajabi-webhook/1.0" },
      });

      const { POST } = await import("@/app/api/webhooks/kajabi/route");
      const response = await POST(request);
      expect([200, 404]).toContain(response.status);
    });
  });

  describe("payload schema validation", () => {
    it("returns 400 on invalid JSON", async () => {
      const request = new Request(URL, {
        method: "POST",
        headers: { "user-agent": "Kajabi-Webhook/1.0", "content-type": "application/json" },
        body: "not-json",
      }) as any;

      const { POST } = await import("@/app/api/webhooks/kajabi/route");
      const response = await POST(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Invalid JSON");
    });

    it("returns 400 when payload doesn't match the schema (missing event)", async () => {
      const request = makeRequest({
        method: "POST",
        url: URL,
        body: { offer: { id: "off_test_123" } },
        headers: { "user-agent": "Kajabi-Webhook/1.0" },
      });

      const { POST } = await import("@/app/api/webhooks/kajabi/route");
      const response = await POST(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Invalid payload");
    });
  });

  describe("happy path", () => {
    it("applies inventory via Convex and returns 200 on a valid Kajabi purchase", async () => {
      vi.mocked(convexServerCall)
        .mockResolvedValueOnce({
          success: true,
          mapping: {
            offerId: "off_test_123",
            instructorSlug: "instructor_test",
            mentorshipType: "one-on-one",
            kajabiOfferUrl: "https://example.com/offer",
          },
        })
        .mockResolvedValueOnce({ success: true, alreadyApplied: false, newValue: 9, oldValue: 10 });

      const request = makeRequest({
        method: "POST",
        url: URL,
        body: makeKajabiPayload({ transaction: { id: "tx_unique_xyz", quantity: 1 } }),
        headers: { "user-agent": "Kajabi-Webhook/1.0" },
      });

      const { POST } = await import("@/app/api/webhooks/kajabi/route");
      const response = await POST(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.received).toBe(true);
      expect(body.instructor).toBe("instructor_test");
      expect(body.quantity).toBe(1);
      expect(body.newInventory).toBe(9);
      expect(body.alreadyApplied).toBe(false);
    });

    it("emits inventory.changed observability event with previousInventory + newInventory on a successful apply", async () => {
      // Greptile P2 'Inventory baseline is always null': the handler
      // must read the pre-change inventory from the Convex response
      // (field name `oldValue`) and surface it as
      // `context.previousInventory` so the per-instructor drop alert
      // documented in kajabi-webhook-security.md can compute the
      // before-and-after diff. Without this, every event would have
      // previousInventory: null and the alert would have no signal.
      const reportError = (await import("@/lib/observability")).reportError;

      vi.mocked(convexServerCall)
        .mockResolvedValueOnce({
          success: true,
          mapping: {
            offerId: "off_test_123",
            instructorSlug: "instructor_test",
            mentorshipType: "one-on-one",
            kajabiOfferUrl: "https://example.com/offer",
          },
        })
        .mockResolvedValueOnce({ success: true, alreadyApplied: false, newValue: 9, oldValue: 10 });

      const request = makeRequest({
        method: "POST",
        url: URL,
        body: makeKajabiPayload({ transaction: { id: "tx_inventory_event_test", quantity: 1 } }),
        headers: { "user-agent": "Kajabi-Webhook/1.0" },
      });

      const { POST } = await import("@/app/api/webhooks/kajabi/route");
      const response = await POST(request);
      expect(response.status).toBe(200);

      const inventoryCalls = vi.mocked(reportError).mock.calls.filter(
        (c) => c[0]?.source === "inventory.changed",
      );
      expect(inventoryCalls).toHaveLength(1);
      expect(inventoryCalls[0][0].level).toBe("info");
      expect(inventoryCalls[0][0].context).toMatchObject({
        instructorSlug: "instructor_test",
        type: "one-on-one",
        previousInventory: 10,
        newInventory: 9,
        quantity: 1,
      });
      // PII: purchaseId embeds buyer email when Kajabi sends a
      // transaction id, so it must NOT be present in the event sent
      // to BetterStack/Axiom. Operators pivot via the
      // inventoryChangeLog Convex table instead.
      expect(inventoryCalls[0][0].context).not.toHaveProperty("purchaseId");
    });
  });

  describe("offer lookup", () => {
    it("returns 404 when Convex reports no mapping for the offer", async () => {
      vi.mocked(convexServerCall).mockResolvedValueOnce({ success: true, mapping: null });

      const request = makeRequest({
        method: "POST",
        url: URL,
        body: makeKajabiPayload(),
        headers: { "user-agent": "Kajabi-Webhook/1.0" },
      });

      const { POST } = await import("@/app/api/webhooks/kajabi/route");
      const response = await POST(request);
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe("Offer mapping not found");
    });

    it("returns 500 when Convex lookup fails (transient — Kajabi should retry)", async () => {
      vi.mocked(convexServerCall).mockRejectedValueOnce(
        new ConvexServerCallError("Network error reaching Convex", 502),
      );

      const request = makeRequest({
        method: "POST",
        url: URL,
        body: makeKajabiPayload(),
        headers: { "user-agent": "Kajabi-Webhook/1.0" },
      });

      const { POST } = await import("@/app/api/webhooks/kajabi/route");
      const response = await POST(request);
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe("Offer mapping lookup failed");
    });
  });
});
