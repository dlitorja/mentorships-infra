import { eq, and } from "drizzle-orm";
import { db } from "../drizzle";
import { payments } from "../../schema";
import type { PaymentStatus } from "../../schema/payments";
import type { PaymentProvider } from "../../schema/orders";

export type Payment = typeof payments.$inferSelect;

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
): Promise<Payment> {
  // Idempotency check: query for existing payment by providerPaymentId
  const existing = await getPaymentByProviderId(provider, providerPaymentId);
  if (existing) {
    return existing;
  }

  // Create new payment
  try {
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

    if (!payment) {
      throw new Error("Failed to create payment");
    }

    return payment;
  } catch (error: unknown) {
    // Handle unique constraint violation (if DB has unique constraint on providerPaymentId)
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505" // PostgreSQL unique violation
    ) {
      // Return existing payment
      const existing = await getPaymentByProviderId(provider, providerPaymentId);
      if (existing) {
        return existing;
      }
    }
    throw error;
  }
}

/**
 * Get payment by ID
 * 
 * @param paymentId - UUID of the payment
 * @returns Payment or null if not found
 */
export async function getPaymentById(paymentId: string): Promise<Payment | null> {
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
): Promise<Payment | null> {
  const [payment] = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.provider, provider),
        eq(payments.providerPaymentId, providerPaymentId)
      )
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
): Promise<Payment> {
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

  const [updated] = await db
    .update(payments)
    .set(updateData)
    .where(eq(payments.id, paymentId))
    .returning();

  if (!updated) {
    throw new Error(`Payment ${paymentId} not found`);
  }

  // Structured logging for observability
  console.info("Payment status updated", {
    paymentId,
    status,
    refundedAmount,
    updatedAt: updated.updatedAt,
  });

  return updated;
}

/**
 * Get payments for an order
 * 
 * @param orderId - UUID of the order
 * @returns Array of payments
 */
export async function getOrderPayments(orderId: string): Promise<Payment[]> {
  const orderPayments = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId));

  return orderPayments;
}
