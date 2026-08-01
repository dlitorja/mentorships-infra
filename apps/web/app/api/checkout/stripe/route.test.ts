import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { makeRequest } from "tests/unit/api-route-utils";
import { stripe } from "@/lib/stripe";

vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn(() => convexClient),
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(),
      },
    },
  },
}));

const convexClient = {
  query: vi.fn(),
  mutation: vi.fn(),
};

const mockStripeCheckoutCreate = stripe.checkout.sessions.create as unknown as ReturnType<typeof vi.fn>;

const validBody = {
  packId: "pack_1",
  promotionCode: "PROMO50",
};

const pack = {
  _id: "pack_1",
  name: "5 Session Pack",
  price: 50000,
  stripePriceId: "price_123",
};

const order = {
  _id: "order_1",
  userId: "guest",
  status: "pending",
};

function makeCheckoutRequest(body: object = validBody) {
  return makeRequest({ method: "POST", url: "https://web.test/api/checkout/stripe", body });
}

describe("POST /api/checkout/stripe (web)", () => {
  const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://test.convex.site";
    convexClient.query.mockResolvedValue(pack);
    convexClient.mutation.mockImplementation((api: any, args: any) => {
      if (args.status === "pending") return order;
      if (args.status === "failed") return { ...order, status: "failed" };
      return null;
    });
    mockStripeCheckoutCreate.mockResolvedValue({
      url: "https://checkout.stripe.test/session_123",
    });
  });

  it("returns 400 for invalid request body", async () => {
    const response = await POST(makeCheckoutRequest({ packId: "" }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Invalid request");
  });

  it("returns 404 when pack is not found", async () => {
    convexClient.query.mockResolvedValueOnce(null);
    const response = await POST(makeCheckoutRequest());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Pack not found" });
  });

  it("returns 400 when pack has no stripe price id", async () => {
    convexClient.query.mockResolvedValueOnce({ ...pack, stripePriceId: null });
    const response = await POST(makeCheckoutRequest());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Stripe price ID not configured for this pack",
    });
  });

  it("creates Stripe checkout session with promotion code", async () => {
    const response = await POST(makeCheckoutRequest());
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.url).toBe("https://checkout.stripe.test/session_123");
    const sessionParams = mockStripeCheckoutCreate.mock.calls[0][0];
    expect(sessionParams).toMatchObject({
      mode: "payment",
      line_items: [{ price: "price_123", quantity: 1 }],
      discounts: [{ promotion_code: "PROMO50" }],
      metadata: {
        order_id: "order_1",
        user_id: "guest",
        pack_id: "pack_1",
      },
    });
  });

  it("returns 500 when Stripe session creation fails", async () => {
    mockStripeCheckoutCreate.mockRejectedValueOnce(new Error("Stripe error"));
    const response = await POST(makeCheckoutRequest());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Checkout failed" });
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
  });
});
