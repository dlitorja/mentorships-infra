import { RefundRequest, PaymentsController } from "@paypal/paypal-server-sdk";
import { getPayPalClient } from "./client";

/**
 * Create a refund for a PayPal capture
 * 
 * @param captureId - PayPal capture ID
 * @param amount - Amount to refund in dollars (null for full refund)
 * @param currency - Currency code (e.g., "USD")
 * @param note - Note for refund (optional)
 * @returns Refund object
 */
export async function createRefund(
  captureId: string,
  amount: string | null = null,
  currency: string = "USD",
  note?: string
) {
  const client = getPayPalClient();

  const refundRequest: RefundRequest = {};

  if (amount !== null) {
    refundRequest.amount = {
      value: parseFloat(amount).toFixed(2),
      currencyCode: currency.toUpperCase(),
    };
  }

  if (note) {
    refundRequest.noteToPayer = note;
  }

  const paymentsController = new PaymentsController(client);
  const response = await paymentsController.refundCapturedPayment({
    captureId,
    body: refundRequest,
  });

  if (response.statusCode !== 201 || !response.result) {
    throw new Error(
      `Failed to create PayPal refund: ${response.statusCode} ${JSON.stringify(response.result)}`
    );
  }

  return response.result;
}

/**
 * Calculate refund amount based on remaining sessions
 * 
 * Formula: (refundable_sessions / total_sessions) * amount_paid
 * 
 * @param totalSessions - Total sessions in pack (e.g., 4)
 * @param remainingSessions - Remaining unused sessions
 * @param totalAmount - Total amount paid in dollars
 * @returns Refund amount in dollars (as string with 2 decimal places)
 */
export function calculateRefundAmount(
  totalSessions: number,
  remainingSessions: number,
  totalAmount: string
): string {
  if (remainingSessions <= 0) {
    return "0.00";
  }

  if (remainingSessions >= totalSessions) {
    return parseFloat(totalAmount).toFixed(2); // Full refund
  }

  const refundableSessions = remainingSessions;
  const refundAmount = (refundableSessions / totalSessions) * parseFloat(totalAmount);

  return refundAmount.toFixed(2);
}

