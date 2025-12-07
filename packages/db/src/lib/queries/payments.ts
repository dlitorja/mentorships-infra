import { eq, and } from "drizzle-orm";
import { db } from "../drizzle";
import { payments } from "../../schema";
import type { paymentProviderEnum } from "../../schema/orders";

type PaymentProvider = "stripe" | "paypal";
type Payment = typeof payments.$inferSelect;

/**
 * Get payment by provider and provider payment ID
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
 */
export async function updatePaymentStatus(
  paymentId: string,
  status: "pending" | "completed" | "refunded" | "failed",
  refundedAmount?: string
): Promise<Payment> {
  const [updated] = await db
    .update(payments)
    .set({
      status,
      refundedAmount: refundedAmount ? refundedAmount : undefined,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, paymentId))
    .returning();

  if (!updated) {
    throw new Error(`Payment ${paymentId} not found`);
  }

  return updated;
}

/**
 * Create payment with idempotency check
 */
export async function createPayment(
  orderId: string,
  provider: PaymentProvider,
  providerPaymentId: string,
  amount: string,
  currency: string = "usd",
  status: "pending" | "completed" | "refunded" | "failed" = "pending"
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

