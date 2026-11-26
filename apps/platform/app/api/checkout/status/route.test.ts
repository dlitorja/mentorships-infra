import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { GET } from "./route";
import { convexServerCall } from "@/lib/convex-server-call";

vi.mock("@/lib/convex-server-call", () => ({
  convexServerCall: vi.fn(),
}));

const mockConvexServerCall = vi.mocked(convexServerCall);

function makeStatusRequest(search: string): NextRequest {
  return {
    nextUrl: new URL(`https://platform.test/api/checkout/status${search}`),
  } as unknown as NextRequest;
}

const statusPayload = {
  orderStatus: "paid",
  provider: "stripe",
  totalAmount: "500.00",
  currency: "usd",
  paymentStatus: "completed",
  packStatus: "active",
  remainingSessions: 4,
  totalSessions: 4,
  seatStatus: "active",
  hasWorkspace: true,
  onboardingId: null,
};

describe("GET /api/checkout/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 without an order id", async () => {
    const response = await GET(makeStatusRequest(""));
    expect(response.status).toBe(400);
    expect(mockConvexServerCall).not.toHaveBeenCalled();
  });

  it("returns 404 when the order does not exist", async () => {
    mockConvexServerCall.mockResolvedValueOnce(null);

    const response = await GET(makeStatusRequest("?order_id=missing"));

    expect(response.status).toBe(404);
  });

  it("returns the fulfilment status and disables caching", async () => {
    mockConvexServerCall.mockResolvedValueOnce(statusPayload);

    const response = await GET(makeStatusRequest("?order_id=order_1"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(json).toEqual(statusPayload);
    expect(mockConvexServerCall).toHaveBeenCalledWith("/orders/checkout-status", {
      id: "order_1",
    });
  });

  it("returns 502 when Convex is unreachable", async () => {
    mockConvexServerCall.mockRejectedValueOnce(new Error("boom"));

    const response = await GET(makeStatusRequest("?order_id=order_1"));

    expect(response.status).toBe(502);
  });
});
