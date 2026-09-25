import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { makeRequest } from "../../../../../../tests/unit/api-route-utils";

vi.mock("@/lib/ratelimit", async () => {
  const actual = await vi.importActual("@/lib/ratelimit");
  return {
    ...actual,
    protectWithRateLimit: vi.fn(),
  };
});

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
    // Reset mock implementations and queued return values so each test
    // starts with a fresh, empty mock queue (mockReset clears both).
    vi.mocked(protectWithRateLimit).mockReset();
    vi.mocked(convexServerCall).mockReset();
    // Default: rate-limit middleware is "open" (returns null = pass-through).
    vi.mocked(protectWithRateLimit).mockResolvedValue(null);
  });

  describe("rate-limit protection", () => {
    it("returns 429 when protectWithRateLimit returns a 429 response, and short-circuits before any Convex call", async () => {
      vi.mocked(protectWithRateLimit).mockResolvedValueOnce(
        new NextResponse("Too many requests", { status: 429 }),
      );

      const request = makeRequest({
        method: "POST",
        url: URL,
        body: makeKajabiPayload(),
        headers: { "user-agent": "Kajabi-Webhook/1.0" },
      });

      const { POST } = await import("@/app/api/webhooks/kajabi/route");
      const response = await POST(request);
      expect(response.status).toBe(429);
      expect(vi.mocked(convexServerCall)).not.toHaveBeenCalled();
    });

    it("calls protectWithRateLimit BEFORE any payload parsing (cheap rejection)", async () => {
      // Even a totally empty body should still be rate-limit-checked.
      const emptyRequest = new Request(URL, {
        method: "POST",
        headers: { "user-agent": "" },
        body: "",
      }) as any;

      vi.mocked(protectWithRateLimit).mockResolvedValueOnce(
        new NextResponse("Too many requests", { status: 429 }),
      );

      const { POST } = await import("@/app/api/webhooks/kajabi/route");
      const response = await POST(emptyRequest);
      expect(response.status).toBe(429);
      expect(vi.mocked(protectWithRateLimit)).toHaveBeenCalledTimes(1);
    });

    it("falls through when protectWithRateLimit returns null (no redis configured or under limit)", async () => {
      vi.mocked(protectWithRateLimit).mockResolvedValueOnce(null);
      vi.mocked(convexServerCall)
        .mockResolvedValueOnce({ success: true, mapping: null })
        .mockResolvedValueOnce({ success: true, alreadyApplied: false, newValue: 4 });

      const request = makeRequest({
        method: "POST",
        url: URL,
        body: makeKajabiPayload(),
        headers: { "user-agent": "Kajabi-Webhook/1.0" },
      });

      const { POST } = await import("@/app/api/webhooks/kajabi/route");
      const response = await POST(request);
      // not_found path: 404 (we're returning null for the lookup)
      expect([200, 404]).toContain(response.status);
      expect(vi.mocked(protectWithRateLimit)).toHaveBeenCalledTimes(1);
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

    it("accepts a User-Agent containing 'Kajabi' (case-insensitive)", async () => {
      vi.mocked(convexServerCall)
        .mockResolvedValueOnce({ success: true, mapping: null })
        .mockResolvedValueOnce({ success: true, alreadyApplied: false, newValue: 4 });

      const request = makeRequest({
        method: "POST",
        url: URL,
        body: makeKajabiPayload(),
        headers: { "user-agent": "kajabi-webhook/1.0" },
      });

      const { POST } = await import("@/app/api/webhooks/kajabi/route");
      const response = await POST(request);
      // not_found → 404
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
        body: { offer: { id: "off_test_123" } }, // no event field
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
        .mockResolvedValueOnce({ success: true, alreadyApplied: false, newValue: 9 });

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
