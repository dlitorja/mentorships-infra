import type Stripe from "stripe";
import { getStripeClient } from "./client";

/**
 * Create a refund for a payment
 * 
 * @param paymentIntentId - Stripe Payment Intent ID
 * @param amount - Amount to refund in cents (null for full refund)
 * @param reason - Reason for refund (optional)
 * @returns Refund object
 */
export async function createRefund(
  paymentIntentId: string,
  amount: number | null = null,
  reason?: "duplicate" | "fraudulent" | "requested_by_customer"
): Promise<Stripe.Refund> {
  const stripe = getStripeClient();

  const refundParams: Stripe.RefundCreateParams = {
    payment_intent: paymentIntentId,
  };

  if (amount !== null) {
    refundParams.amount = amount;
  }

  if (reason) {
    refundParams.reason = reason;
  }

  const refund = await stripe.refunds.create(refundParams);

  return refund;
}

/**
 * Get refund by ID
 * 
 * @param refundId - Stripe Refund ID
 * @returns Refund object
 */
export async function getRefund(
  refundId: string
): Promise<Stripe.Refund> {
  const stripe = getStripeClient();

  const refund = await stripe.refunds.retrieve(refundId);

  return refund;
}

/**
 * List refunds for a payment intent
 * 
 * @param paymentIntentId - Stripe Payment Intent ID
 * @returns Array of refunds
 */
export async function listRefunds(
  paymentIntentId: string
): Promise<Stripe.Refund[]> {
  const stripe = getStripeClient();

  const refunds = await stripe.refunds.list({
    payment_intent: paymentIntentId,
  });

  return refunds.data;
}

/**
 * Calculate refund amount based on remaining sessions
 * 
 * Formula: (refundable_sessions / total_sessions) * amount_paid
 * 
 * @param totalSessions - Total sessions in pack (e.g., 4)
 * @param remainingSessions - Remaining unused sessions
 * @param totalAmount - Total amount paid in cents
 * @returns Refund amount in cents
 */
export function calculateRefundAmount(
  totalSessions: number,
  remainingSessions: number,
  totalAmount: number
): number {
  if (remainingSessions <= 0) {
    return 0;
  }

  if (remainingSessions >= totalSessions) {
    return totalAmount; // Full refund
  }

  const refundableSessions = remainingSessions;
  const refundAmount = Math.round(
    (refundableSessions / totalSessions) * totalAmount
  );

  return refundAmount;
}

