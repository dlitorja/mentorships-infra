/**
 * Metadata to include in PayPal order
 * These values are passed through webhooks for pack creation
 */
export interface PayPalOrderMetadata {
  userId: string; // Clerk user ID
  mentorId: string; // Mentor UUID
  productId?: string; // Mentorship product UUID (optional)
  orderId?: string; // Order UUID (optional, if order created before checkout)
}

/**
 * Result of creating a PayPal order
 */
export interface PayPalOrderResult {
  orderId: string; // PayPal order ID
  approvalUrl: string; // Redirect URL for customer to approve payment
}

/**
 * PayPal webhook event types we handle
 */
export type PayPalWebhookEventType =
  | "PAYMENT.CAPTURE.COMPLETED"
  | "PAYMENT.CAPTURE.REFUNDED";

/**
 * Extended PayPal webhook event with parsed data
 */
export interface ParsedPayPalEvent {
  id: string;
  eventType: PayPalWebhookEventType | string;
  resourceType: string;
  summary: string;
  resource: Record<string, unknown>;
  metadata: Record<string, string>;
}

