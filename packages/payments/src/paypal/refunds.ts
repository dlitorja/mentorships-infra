import { RefundRequest, PaymentsController, Refund } from "@paypal/paypal-server-sdk";
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
): Promise<Refund> {
  const client = getPayPalClient();

  const refundRequest: RefundRequest = {};

  if (amount !== null) {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount < 0) {
      throw new Error(`Invalid refund amount: ${amount}`);
    }
    refundRequest.amount = {
      value: parsedAmount.toFixed(2),
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
    const debugId = (response.result as { debug_id?: string } | undefined)?.debug_id;
    throw new Error(
      `Failed to create PayPal refund: ${response.statusCode}` +
      (debugId ? ` (debug_id=${debugId})` : "")
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

  if (totalSessions <= 0) {
    return "0.00";
  }

  const parsed = parseFloat(totalAmount);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return "0.00";
  }

  if (remainingSessions >= totalSessions) {
    return parsed.toFixed(2); // Full refund
  }

  // Use integer math to avoid floating-point precision issues
  const totalCents = Math.round(parsed * 100);
  const refundCents = Math.round((remainingSessions / totalSessions) * totalCents);
  return (refundCents / 100).toFixed(2);
}

