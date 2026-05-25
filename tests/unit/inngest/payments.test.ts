import { describe, it, expect, vi, beforeEach } from "vitest";

// Set up environment variables before imports
process.env.NEXT_PUBLIC_CONVEX_URL = "https://test-convex-url.convex.cloud";

// Mock the ConvexHttpClient with dynamic response and record mutation calls
vi.mock("convex/browser", () => {
  const mockOrders = new Map();
  const mockPayments = new Map();
  const mutationCalls: Array<{ name: string; args: any }> = [];

  function record(name: string, args: any) {
    mutationCalls.push({ name, args });
    return "test-mutation-id";
  }

  return {
    ConvexHttpClient: vi.fn().mockImplementation(() => ({
      query: vi.fn((api: any, args: any) => {
        if (args?.provider && args?.providerPaymentId) {
          const key = `${args.provider}:${args.providerPaymentId}`;
          return Promise.resolve(mockPayments.get(key) || null);
        }
        if (args?.id) {
          return Promise.resolve(mockOrders.get(args.id) || null);
        }
        if (args?.sessionPackId) {
          // seatReservations.getSeatReservationBySessionPack
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      }),
      mutation: vi.fn((api: any, args: any) => {
        // Infer operation name based on known arg shapes
        if (args?.id && !args?.status && !args?.refundedAmount && !args?.orderId) {
          return Promise.resolve(record("orders.completeOrder", args));
        }
        if (args?.orderId && args?.provider && args?.amount) {
          return Promise.resolve(record("payments.createPayment", args));
        }
        if (args?.userId && args?.instructorId && args?.totalSessions) {
          return Promise.resolve(record("sessionPacks.createSessionPack", args));
        }
        if (args?.instructorId && args?.userId && args?.sessionPackId) {
          return Promise.resolve(record("seatReservations.createSeatReservation", args));
        }
        if (args?.id && args?.refundedAmount) {
          return Promise.resolve(record("payments.refundPayment", args));
        }
        return Promise.resolve("test-mutation-id");
      }),
    })),
    __setMockOrder: (id: string, data: any) => mockOrders.set(id, data),
    __setMockPayment: (provider: string, providerPaymentId: string, data: any) =>
      mockPayments.set(`${provider}:${providerPaymentId}`, data),
    __getMutationCalls: () => mutationCalls,
    __clearMocks: () => {
      mockOrders.clear();
      mockPayments.clear();
      mutationCalls.splice(0, mutationCalls.length);
    },
  };
});

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
      // Import the mock module to set up data
      const convexMock = await import("convex/browser");
      const paymentModule = await import("../../../apps/web/inngest/functions/payments");

      const mockOrder = {
        _id: "order_123",
        status: "paid",
        userId: "user_123",
        totalAmount: "100.00",
        provider: "stripe" as const,
        currency: "usd",
      };

      // Set up the mock data
      convexMock.__setMockOrder!("order_123", mockOrder);

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
          return fn();
        }),
      };

      const handler = paymentModule.processStripeCheckout.handler;
      const result = await handler({ event: mockEvent, step: mockStep as any } as any);

      expect(result.alreadyProcessed).toBe(true);
      expect(result.message).toBe("Order already processed");

      // Clean up
      convexMock.__clearMocks!();
    });

    it("should throw error when order not found after retries", async () => {
      const convexMock = await import("convex/browser");
      const paymentModule = await import("../../../apps/web/inngest/functions/payments");

      // Don't set any mock order - it will return null and throw after retries

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
          return fn();
        }),
      };

      const handler = paymentModule.processStripeCheckout.handler;
      await expect(
        handler({ event: mockEvent, step: mockStep as any } as any)
      ).rejects.toThrow("Order order_123 not found after retries");

      // Clean up
      convexMock.__clearMocks!();
    });

    it("should process PayPal refund with idempotency check", async () => {
      const convexMock = await import("convex/browser");
      const paymentModule = await import("../../../apps/web/inngest/functions/payments");

      const mockPayment = {
        _id: "payment_123",
        orderId: "order_123",
        providerPaymentId: "capture_123",
        status: "refunded",
        amount: "100.00",
        provider: "paypal" as const,
        currency: "usd",
      };

      // Set up the mock data
      convexMock.__setMockPayment!("paypal", "capture_123", mockPayment);

      const mockEvent = {
        data: {
          captureId: "capture_123",
          refundId: "refund_123",
        },
      };

      const mockStep = {
        run: vi.fn(async (name: string, fn: () => Promise<any>) => {
          return fn();
        }),
      };

      const handler = paymentModule.processPayPalRefund.handler;
      const result = await handler({ event: mockEvent, step: mockStep as any } as any);

      expect(result.alreadyProcessed).toBe(true);
      expect(result.message).toBe("Payment already refunded");

      // Clean up
      convexMock.__clearMocks!();
    });

    it("uses resolvedUserId for session pack and seat reservation (Stripe)", async () => {
      const convexMock = await import("convex/browser");
      const paymentModule = await import("../../../apps/web/inngest/functions/payments");

      const mockOrder = {
        _id: "order_abc",
        status: "pending",
        userId: "guest",
        totalAmount: "200.00",
        provider: "stripe" as const,
        currency: "usd",
      };
      convexMock.__setMockOrder!("order_abc", mockOrder);

      // Mock stripe session retrieve
      const stripeLib = await import("../../../apps/web/lib/stripe");
      (stripeLib as any).stripe.checkout.sessions.retrieve.mockResolvedValue({
        id: "cs_test",
        amount_total: 20000,
        currency: "usd",
        total_details: {},
        payment_intent: "pi_123",
      });

      const mockEvent = {
        data: {
          sessionId: "cs_test",
          orderId: "order_abc",
          userId: "guest",
          packId: "pack_123",
          studentEmail: "Guest@Example.com",
        },
      };

      const mockStep = {
        run: vi.fn(async (_name: string, fn: () => Promise<any>) => fn()),
      };

      const handler = paymentModule.processStripeCheckout.handler;
      await handler({ event: mockEvent, step: mockStep as any } as any);

      const calls = convexMock.__getMutationCalls!();
      const sp = calls.find((c: any) => c.name === "sessionPacks.createSessionPack");
      const sr = calls.find((c: any) => c.name === "seatReservations.createSeatReservation");
      expect(sp?.args.userId).toBe("email:guest@example.com");
      expect(sr?.args.userId).toBe("email:guest@example.com");

      convexMock.__clearMocks!();
    });
  });
});
