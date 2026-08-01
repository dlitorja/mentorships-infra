import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { makeRequest } from "tests/unit/api-route-utils";
import { getConvexClient } from "@/lib/convex";
import { stripe } from "@/lib/stripe";

vi.mock("@/lib/convex", () => ({
  getConvexClient: vi.fn(),
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

vi.mock("@/lib/clerk-magic-links", () => ({
  sendEmailLinkForUser: vi.fn(),
}));

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(() => ({ userId: null })),
  clerkClient: vi.fn(() => ({
    users: {
      getUserList: vi.fn(() => ({ data: [] })),
      createUser: vi.fn(() => ({ id: "clerk_user_new" })),
    },
  })),
}));

const mockGetConvexClient = getConvexClient as unknown as ReturnType<typeof vi.fn>;
const mockStripeCheckoutCreate = stripe.checkout.sessions.create as unknown as ReturnType<typeof vi.fn>;

const convexClient = {
  query: vi.fn(),
  mutation: vi.fn(),
};

const validBody = {
  packId: "pack_1",
  email: "student@example.com",
  fullName: "Student Name",
};

const pack = {
  _id: "pack_1",
  name: "5 Pack",
  price: 50000,
  stripePriceId: "price_123",
};

const order = {
  _id: "order_1",
  userId: "guest",
  status: "pending",
};

function makeCheckoutRequest(body: object = validBody) {
  return makeRequest({ method: "POST", url: "https://platform.test/api/checkout/stripe", body });
}

describe("POST /api/checkout/stripe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConvexClient.mockReturnValue(convexClient);
    convexClient.query.mockResolvedValue(pack);
    convexClient.mutation.mockImplementation((api: any, args: any) => {
      if (args.status === "pending") return order;
      if (args.status === "failed") return { ...order, status: "failed" };
      return null;
    });
    mockStripeCheckoutCreate.mockResolvedValue({
      url: "https://checkout.stripe.com/session_123",
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

  it("returns 400 for guest checkout without email or full name", async () => {
    const response = await POST(makeCheckoutRequest({ packId: "pack_1" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Email and full name are required",
    });
  });

  it("creates Stripe checkout session for guest user", async () => {
    const response = await POST(makeCheckoutRequest());
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.url).toBe("https://checkout.stripe.com/session_123");
    expect(mockStripeCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        line_items: [{ price: "price_123", quantity: 1 }],
        metadata: expect.objectContaining({
          order_id: "order_1",
          pack_id: "pack_1",
        }),
      })
    );
  });

  it("creates Stripe checkout session for authenticated user", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ userId: "clerk_user_123" });

    const response = await POST(makeCheckoutRequest());
    expect(response.status).toBe(200);
    expect(mockStripeCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ user_id: "clerk_user_123" }),
      })
    );
  });

  it("applies promotion code when provided", async () => {
    const response = await POST(makeCheckoutRequest({ ...validBody, promotionCode: "PROMO50" }));
    expect(response.status).toBe(200);
    const sessionParams = mockStripeCheckoutCreate.mock.calls[0][0];
    expect(sessionParams.discounts).toEqual([{ promotion_code: "PROMO50" }]);
    expect(sessionParams.allow_promotion_codes).toBe(false);
  });

  it("returns 500 when Stripe session creation fails", async () => {
    mockStripeCheckoutCreate.mockRejectedValueOnce(new Error("Stripe error"));
    const response = await POST(makeCheckoutRequest());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Checkout failed" });
    expect(convexClient.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "order_1", status: "failed" })
    );
  });
});
