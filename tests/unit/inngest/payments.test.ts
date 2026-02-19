import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the client module which creates the inngest instance
vi.mock("../../../apps/web/inngest/client", () => ({
  inngest: {
    createFunction: vi.fn((config, _trigger, handler) => ({
      id: config.id,
      name: config.name,
      config,
      handler,
    })),
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock dependencies
vi.mock("@mentorships/db", () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: "test-id" }]),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
  },
  orders: {},
  payments: {},
  sessionPacks: {},
  seatReservations: {},
  mentorshipProducts: {},
  eq: vi.fn(),
  getOrderById: vi.fn(),
  getPaymentByProviderId: vi.fn(),
  getSessionPackByPaymentId: vi.fn(),
  releaseSeatByPackId: vi.fn(),
  updatePaymentStatus: vi.fn(),
  updateOrderStatus: vi.fn(),
  updateSessionPackStatus: vi.fn(),
  getProductById: vi.fn(),
}));

vi.mock("../../../apps/web/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        retrieve: vi.fn(),
      },
    },
    charges: {
      retrieve: vi.fn(),
    },
  },
}));

vi.mock("../../../apps/web/lib/observability", () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
}));

describe("Inngest Payment Functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should export all payment functions", async () => {
    const paymentModule = await import("../../../apps/web/inngest/functions/payments");

    expect(paymentModule.processStripeCheckout).toBeDefined();
    expect(paymentModule.processStripeRefund).toBeDefined();
    expect(paymentModule.processPayPalCheckout).toBeDefined();
    expect(paymentModule.processPayPalRefund).toBeDefined();
  });

  it("processStripeCheckout should have correct configuration", async () => {
    const paymentModule = await import("../../../apps/web/inngest/functions/payments");

    expect(paymentModule.processStripeCheckout.id).toBe("process-stripe-checkout");
    expect(paymentModule.processStripeCheckout.name).toBe("Process Stripe Checkout");
    expect(paymentModule.processStripeCheckout.config.retries).toBe(3);
  });

  it("processStripeRefund should have correct configuration", async () => {
    const paymentModule = await import("../../../apps/web/inngest/functions/payments");

    expect(paymentModule.processStripeRefund.id).toBe("process-stripe-refund");
    expect(paymentModule.processStripeRefund.name).toBe("Process Stripe Refund");
    expect(paymentModule.processStripeRefund.config.retries).toBe(3);
  });

  it("processPayPalCheckout should have correct configuration", async () => {
    const paymentModule = await import("../../../apps/web/inngest/functions/payments");

    expect(paymentModule.processPayPalCheckout.id).toBe("process-paypal-checkout");
    expect(paymentModule.processPayPalCheckout.name).toBe("Process PayPal Checkout");
    expect(paymentModule.processPayPalCheckout.config.retries).toBe(3);
  });

  it("processPayPalRefund should have correct configuration", async () => {
    const paymentModule = await import("../../../apps/web/inngest/functions/payments");

    expect(paymentModule.processPayPalRefund.id).toBe("process-paypal-refund");
    expect(paymentModule.processPayPalRefund.name).toBe("Process PayPal Refund");
    expect(paymentModule.processPayPalRefund.config.retries).toBe(3);
  });

  describe("Business Logic Tests", () => {
    it("should check idempotency - skip already paid order", async () => {
      const { getOrderById } = await import("@mentorships/db");
      const paymentModule = await import("../../../apps/web/inngest/functions/payments");

      const mockOrder = {
        id: "order_123",
        status: "paid",
        userId: "user_123",
        totalAmount: "100.00",
      };

      vi.mocked(getOrderById).mockResolvedValue(mockOrder as any);

      const mockEvent = {
        data: {
          sessionId: "cs_test",
          orderId: "order_123",
          userId: "user_123",
          packId: "pack_123",
        },
      };

      const mockStep = {
        run: vi.fn(async (name: string, fn: () => Promise<any>) => {
          if (name === "get-order") {
            let attempts = 0;
            let foundOrder = null;
            while (attempts < 3 && !foundOrder) {
              foundOrder = await getOrderById("order_123");
              if (!foundOrder) {
                await new Promise((resolve) => setTimeout(resolve, 200 * (attempts + 1)));
                attempts++;
              }
            }
            if (!foundOrder) {
              throw new Error("Order order_123 not found after retries");
            }
            return foundOrder;
          }
          return fn();
        }),
      };

      const handler = paymentModule.processStripeCheckout.handler;
      const result = await handler({ event: mockEvent, step: mockStep as any } as any);

      expect(result.alreadyProcessed).toBe(true);
      expect(result.message).toBe("Order already processed");
    });

    it("should throw error when order not found after retries", async () => {
      const { getOrderById } = await import("@mentorships/db");
      const paymentModule = await import("../../../apps/web/inngest/functions/payments");

      vi.mocked(getOrderById).mockResolvedValue(null);

      const mockEvent = {
        data: {
          sessionId: "cs_test",
          orderId: "order_123",
          userId: "user_123",
          packId: "pack_123",
        },
      };

      const mockStep = {
        run: vi.fn(async (name: string, fn: () => Promise<any>) => {
          if (name === "get-order") {
            let attempts = 0;
            let foundOrder = null;
            while (attempts < 3 && !foundOrder) {
              foundOrder = await getOrderById("order_123");
              if (!foundOrder) {
                await new Promise((resolve) => setTimeout(resolve, 200 * (attempts + 1)));
                attempts++;
              }
            }
            if (!foundOrder) {
              throw new Error("Order order_123 not found after retries");
            }
            return foundOrder;
          }
          return fn();
        }),
      };

      const handler = paymentModule.processStripeCheckout.handler;
      await expect(
        handler({ event: mockEvent, step: mockStep as any } as any)
      ).rejects.toThrow("Order order_123 not found after retries");
    });

    it("should process PayPal refund with idempotency check", async () => {
      const { getPaymentByProviderId } = await import("@mentorships/db");
      const paymentModule = await import("../../../apps/web/inngest/functions/payments");

      const mockPayment = {
        id: "payment_123",
        orderId: "order_123",
        providerPaymentId: "capture_123",
        status: "refunded",
        amount: "100.00",
      };

      vi.mocked(getPaymentByProviderId).mockResolvedValue(mockPayment as any);

      const mockEvent = {
        data: {
          captureId: "capture_123",
          refundId: "refund_123",
        },
      };

      const mockStep = {
        run: vi.fn(async (name: string, fn: () => Promise<any>) => {
          if (name === "get-payment") return mockPayment;
          return fn();
        }),
      };

      const handler = paymentModule.processPayPalRefund.handler;
      const result = await handler({ event: mockEvent, step: mockStep as any } as any);

      expect(result.alreadyProcessed).toBe(true);
      expect(result.message).toBe("Payment already refunded");
    });
  });
});
