import { eq } from "drizzle-orm";
import { db } from "../drizzle";
import { payments } from "../../schema";
import type { PaymentStatus } from "../../schema/payments";
import type { PaymentProvider } from "../../schema/orders";

/**
 * Create a payment record
 * 
 * @param orderId - UUID of the order
 * @param provider - Payment provider (stripe | paypal)
 * @param providerPaymentId - Payment ID from provider (e.g., Stripe payment intent ID)
 * @param amount - Amount as string (e.g., "100.00")
 * @param currency - Currency code (default: "usd")
 * @param status - Payment status (default: "pending")
 * @returns Created payment record
 */
export async function createPayment(
  orderId: string,
  provider: PaymentProvider,
  providerPaymentId: string,
  amount: string,
  currency: string = "usd",
  status: PaymentStatus = "pending"
) {
  const [payment] = await db
    .insert(payments)
    .values({
      orderId,
      provider,
      providerPaymentId,
      amount,
      currency,
      status,
    })
    .returning();

  return payment;
}

/**
 * Get payment by ID
 * 
 * @param paymentId - UUID of the payment
 * @returns Payment or null if not found
 */
export async function getPaymentById(paymentId: string) {
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);

  return payment || null;
}

/**
 * Get payment by provider payment ID
 * 
 * @param provider - Payment provider
 * @param providerPaymentId - Provider's payment ID
 * @returns Payment or null if not found
 */
export async function getPaymentByProviderId(
  provider: PaymentProvider,
  providerPaymentId: string
) {
  const [payment] = await db
    .select()
    .from(payments)
    .where(
      eq(payments.providerPaymentId, providerPaymentId)
    )
    .limit(1);

  return payment || null;
}

/**
 * Update payment status
 * 
 * @param paymentId - UUID of the payment
 * @param status - New payment status
 * @param refundedAmount - Refunded amount if status is refunded (optional)
 * @returns Updated payment record
 */
export async function updatePaymentStatus(
  paymentId: string,
  status: PaymentStatus,
  refundedAmount?: string
) {
  const updateData: {
    status: PaymentStatus;
    refundedAmount?: string;
    updatedAt: Date;
  } = {
    status,
    updatedAt: new Date(),
  };

  if (refundedAmount !== undefined) {
    updateData.refundedAmount = refundedAmount;
  }

  const [payment] = await db
    .update(payments)
    .set(updateData)
    .where(eq(payments.id, paymentId))
    .returning();

  if (!payment) {
    throw new Error(`Payment ${paymentId} not found`);
  }

  return payment;
}

/**
 * Get payments for an order
 * 
 * @param orderId - UUID of the order
 * @returns Array of payments
 */
export async function getOrderPayments(orderId: string) {
  const orderPayments = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId));

  return orderPayments;
}

