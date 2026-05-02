import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const CONVEX_URL = "https://fine-bulldog-260.convex.cloud";
const CONVEX_HTTP_KEY = "prod:fine-bulldog-260|eyJ2MiI6IjdjMDc0NjFhYjA1NTRlNWY4Mzk4ZDQ0ZjU3OTgwNzBmIn0=";

describe("Phase 4A Smoke Tests - Convex API Migration", () => {
  let convex: ConvexHttpClient;
  let testOrderId: string | null = null;

  beforeAll(() => {
    convex = new ConvexHttpClient(CONVEX_URL);
  });

  afterAll(async () => {
    if (testOrderId) {
      try {
        await convex.mutation(api.orders.deleteOrder, {
          id: testOrderId as Id<"orders">,
        });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("Orders Convex Functions (4A-1 Checkout Routes)", () => {
    it("should create an order via Convex mutation", async () => {
      const orderId = await convex.mutation(api.orders.createOrder, {
        userId: "smoke_test_user_" + Date.now(),
        status: "pending",
        provider: "stripe",
        totalAmount: "9900",
        currency: "usd",
      });

      expect(orderId).toBeTruthy();
      expect(typeof orderId).toBe("string");
      testOrderId = orderId as string;
    });

    it("should fetch the created order by ID", async () => {
      if (!testOrderId) {
        expect.fail("No test order ID available");
      }

      const order = await convex.query(api.orders.getOrderById, {
        id: testOrderId as Id<"orders">,
      });

      expect(order).toBeTruthy();
      expect(order?.userId).toContain("smoke_test_user_");
      expect(order?.status).toBe("pending");
      expect(order?.provider).toBe("stripe");
    });

    it("should update order status to paid", async () => {
      if (!testOrderId) {
        expect.fail("No test order ID available");
      }

      const updated = await convex.mutation(api.orders.updateOrder, {
        id: testOrderId as Id<"orders">,
        status: "paid",
      });

      expect(updated).toBeTruthy();
      expect(updated?.status).toBe("paid");
    });

    it("should fetch orders for admin with pagination", async () => {
      const result = await convex.query(api.orders.getOrdersForAdmin, {
        limit: 10,
        offset: 0,
      });

      expect(result).toBeTruthy();
      expect(result.items).toBeTruthy();
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.total).toBe("number");
    });

    it("should cancel an order", async () => {
      if (!testOrderId) {
        expect.fail("No test order ID available");
      }

      const canceled = await convex.mutation(api.orders.cancelOrder, {
        id: testOrderId as Id<"orders">,
      });

      expect(canceled).toBeTruthy();
      expect(canceled?.status).toBe("canceled");
    });
  });

  describe("Products Convex Functions (4A-2 Admin Routes)", () => {
    it("should fetch public active products (no auth required)", async () => {
      const products = await convex.query(api.products.getPublicActiveProducts, {});

      expect(products).toBeTruthy();
      expect(Array.isArray(products)).toBe(true);
    });
  });

  describe("Payments Convex Functions", () => {
    it("should create a payment record", async () => {
      if (!testOrderId) {
        expect.fail("No test order ID available");
      }

      const paymentId = await convex.mutation(api.payments.createPayment, {
        orderId: testOrderId as Id<"orders">,
        provider: "stripe",
        providerPaymentId: "pi_smoke_test_" + Date.now(),
        amount: "9900",
        currency: "usd",
        status: "completed",
      });

      expect(paymentId).toBeTruthy();
      expect(typeof paymentId).toBe("string");
    });

    it("should fetch payments for an order", async () => {
      if (!testOrderId) {
        expect.fail("No test order ID available");
      }

      const payments = await convex.query(api.payments.getOrderPayments, {
        orderId: testOrderId as Id<"orders">,
      });

      expect(payments).toBeTruthy();
      expect(Array.isArray(payments)).toBe(true);
    });
  });
});