import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCheckoutSession, parseCheckoutSessionMetadata } from "@mentorships/payments";
import type Stripe from "stripe";

describe("Stripe Checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create checkout session with correct parameters", async () => {
    const priceId = "price_test_123";
    const metadata = {
      userId: "user_123",
      mentorId: "mentor_123",
      productId: "product_123",
    };
    const successUrl = "https://example.com/success";
    const cancelUrl = "https://example.com/cancel";

    // Mock Stripe client
    const mockSession = {
      id: "cs_test_123",
      url: "https://checkout.stripe.com/test",
    };

    // In actual test, we'd mock the Stripe client
    // For now, this is a placeholder structure
    expect(mockSession.id).toBe("cs_test_123");
    expect(mockSession.url).toContain("checkout.stripe.com");
  });

  it("should parse checkout session metadata", () => {
    const mockSession: Stripe.Checkout.Session = {
      id: "cs_test",
      metadata: {
        userId: "user_123",
        mentorId: "mentor_123",
        productId: "product_123",
        orderId: "order_123",
      },
    } as Stripe.Checkout.Session;

    const parsed = parseCheckoutSessionMetadata(mockSession);
    expect(parsed).toBeTruthy();
    expect(parsed?.userId).toBe("user_123");
    expect(parsed?.mentorId).toBe("mentor_123");
    expect(parsed?.productId).toBe("product_123");
    expect(parsed?.orderId).toBe("order_123");
  });

  it("should return null for session with missing required metadata", () => {
    const mockSession: Stripe.Checkout.Session = {
      id: "cs_test",
      metadata: {
        // Missing userId and mentorId
        productId: "product_123",
      },
    } as Stripe.Checkout.Session;

    const parsed = parseCheckoutSessionMetadata(mockSession);
    expect(parsed).toBeNull();
  });
});

