import {
  OrderRequest,
  OrderApplicationContext,
  OrderApplicationContextUserAction,
  CheckoutPaymentIntent,
  OrdersController,
} from "@paypal/paypal-server-sdk";
import { getPayPalClient } from "./client";
import type { PayPalOrderMetadata, PayPalOrderResult } from "./types";

/**
 * Create a PayPal order for a one-time payment
 * 
 * @param amount - Amount in dollars (e.g., "99.99")
 * @param currency - Currency code (e.g., "USD")
 * @param metadata - Metadata to include in order (userId, mentorId, etc.)
 * @param returnUrl - URL to redirect after successful payment
 * @param cancelUrl - URL to redirect if payment is canceled
 * @returns PayPal order with approval URL
 */
export async function createPayPalOrder(
  amount: string,
  currency: string,
  metadata: PayPalOrderMetadata,
  returnUrl: string,
  cancelUrl: string
): Promise<PayPalOrderResult> {
  const client = getPayPalClient();

  // Convert amount to PayPal format (string with 2 decimal places)
  const amountValue = parseFloat(amount).toFixed(2);

  const orderRequest: OrderRequest = {
    intent: CheckoutPaymentIntent.Capture,
    purchaseUnits: [
      {
        amount: {
          currencyCode: currency.toUpperCase(),
          value: amountValue,
        },
        customId: metadata.orderId || undefined,
        description: "Mentorship Session Pack",
      },
    ],
    applicationContext: {
      brandName: "Mentorship Platform",
      landingPage: "BILLING",
      userAction: OrderApplicationContextUserAction.PayNow,
      returnUrl,
      cancelUrl,
    } as OrderApplicationContext,
  };

  const ordersController = new OrdersController(client);
  const response = await ordersController.createOrder({
    body: orderRequest,
    prefer: "return=representation",
  });

  if (response.statusCode !== 201 || !response.result) {
    throw new Error(
      `Failed to create PayPal order: ${response.statusCode} ${JSON.stringify(response.result)}`
    );
  }

  const order = response.result;
  const approvalUrl = order.links?.find((link: { rel?: string; href?: string }) => link.rel === "approve")?.href;

  if (!approvalUrl) {
    throw new Error("Failed to get approval URL from PayPal order");
  }

  return {
    orderId: order.id!,
    approvalUrl,
  };
}

/**
 * Capture a PayPal order after customer approval
 * 
 * @param orderId - PayPal order ID
 * @returns Captured order with payment details
 */
export async function capturePayPalOrder(orderId: string) {
  const client = getPayPalClient();
  const ordersController = new OrdersController(client);

  const response = await ordersController.captureOrder({
    id: orderId,
    prefer: "return=representation",
  });

  if (response.statusCode !== 201 || !response.result) {
    throw new Error(
      `Failed to capture PayPal order: ${response.statusCode} ${JSON.stringify(response.result)}`
    );
  }

  return response.result;
}

/**
 * Get PayPal order details
 * 
 * @param orderId - PayPal order ID
 * @returns Order details
 */
export async function getPayPalOrder(orderId: string) {
  const client = getPayPalClient();
  const ordersController = new OrdersController(client);

  const response = await ordersController.getOrder({
    id: orderId,
  });

  if (response.statusCode !== 200 || !response.result) {
    throw new Error(
      `Failed to get PayPal order: ${response.statusCode} ${JSON.stringify(response.result)}`
    );
  }

  return response.result;
}

