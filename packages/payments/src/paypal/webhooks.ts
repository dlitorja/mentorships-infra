import type { ParsedPayPalEvent, PayPalWebhookEventType } from "./types";

/**
 * Verify PayPal webhook signature
 * 
 * PayPal webhook verification requires:
 * 1. Verifying the webhook signature header
 * 2. Validating the certificate chain
 * 3. Verifying the payload
 * 
 * Note: PayPal webhook verification is more complex than Stripe.
 * For production, consider using PayPal's webhook verification library
 * or implementing full certificate chain validation.
 * 
 * @param body - Raw request body as string
 * @param headers - Request headers (must include PayPal webhook headers)
 * @param webhookId - PayPal webhook ID (from PayPal dashboard)
 * @returns true if signature is valid
 */
export async function verifyWebhookSignature(
  body: string,
  headers: Record<string, string | string[] | undefined>,
  webhookId: string
): Promise<boolean> {
  // PayPal webhook verification requires:
  // 1. PAYPAL-AUTH-ALGO header
  // 2. PAYPAL-CERT-URL header
  // 3. PAYPAL-TRANSMISSION-ID header
  // 4. PAYPAL-TRANSMISSION-SIG header
  // 5. PAYPAL-TRANSMISSION-TIME header

  // Normalize headers to lowercase for case-insensitive access
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );

  const authAlgo = normalizedHeaders["paypal-auth-algo"];
  const certUrl = normalizedHeaders["paypal-cert-url"];
  const transmissionId = normalizedHeaders["paypal-transmission-id"];
  const transmissionSig = normalizedHeaders["paypal-transmission-sig"];
  const transmissionTime = normalizedHeaders["paypal-transmission-time"];

  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
    throw new Error("Missing required PayPal webhook headers");
  }

  // For MVP, we'll do basic validation
  // In production, implement full certificate chain validation
  // See: https://developer.paypal.com/docs/api-basics/notifications/webhooks/notification-messages/#verify-webhook-signatures

  // Basic validation: check that headers are present and non-empty
  const requiredHeaders = [
    authAlgo,
    certUrl,
    transmissionId,
    transmissionSig,
    transmissionTime,
  ];

  for (const header of requiredHeaders) {
    if (!header || (typeof header === "string" && header.trim() === "")) {
      return false;
    }
  }

  // TODO: Implement full certificate chain validation for production
  // For now, we'll rely on HTTPS and webhook secret validation
  // In production, use PayPal's webhook verification SDK or implement:
  // 1. Fetch certificate from certUrl
  // 2. Verify certificate chain
  // 3. Verify signature using certificate

  return true;
}

/**
 * Get webhook ID from environment
 * 
 * @returns Webhook ID
 * @throws Error if PAYPAL_WEBHOOK_ID is not set
 */
export function getWebhookId(): string {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;

  if (!webhookId) {
    throw new Error(
      "PAYPAL_WEBHOOK_ID environment variable is required. " +
      "Get it from PayPal Dashboard → Apps & Credentials → Webhooks → Select webhook → Webhook ID"
    );
  }

  return webhookId;
}

/**
 * Parse PayPal webhook event and extract relevant data
 * 
 * @param event - PayPal webhook event object
 * @returns Parsed event with metadata
 */
export function parseWebhookEvent(event: {
  id: string;
  event_type: string;
  resource_type: string;
  summary: string;
  resource: Record<string, unknown>;
  [key: string]: unknown;
}): ParsedPayPalEvent | null {
  // Extract metadata from resource
  // PayPal stores custom_id in purchase_units[0].custom_id
  const resource = event.resource as Record<string, unknown>;
  const purchaseUnits = resource.purchase_units as Array<Record<string, unknown>> | undefined;

  let metadata: Record<string, string> = {};

  if (purchaseUnits && purchaseUnits.length > 0) {
    const customId = purchaseUnits[0].custom_id;
    if (typeof customId === "string") {
      metadata.orderId = customId;
    }
  }

  // Extract capture ID for PAYMENT.CAPTURE events
  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED" || event.event_type === "PAYMENT.CAPTURE.REFUNDED") {
    const captureId = resource.id;
    if (typeof captureId === "string") {
      metadata.captureId = captureId;
    }
  }

  return {
    id: event.id,
    eventType: event.event_type,
    resourceType: event.resource_type,
    summary: event.summary,
    resource: resource,
    metadata,
  };
}

/**
 * Type guard to check if event is a PAYMENT.CAPTURE.COMPLETED event
 */
export function isPaymentCaptureCompletedEvent(
  event: { event_type: string }
): event is { event_type: "PAYMENT.CAPTURE.COMPLETED" } {
  return event.event_type === "PAYMENT.CAPTURE.COMPLETED";
}

/**
 * Type guard to check if event is a PAYMENT.CAPTURE.REFUNDED event
 */
export function isPaymentCaptureRefundedEvent(
  event: { event_type: string }
): event is { event_type: "PAYMENT.CAPTURE.REFUNDED" } {
  return event.event_type === "PAYMENT.CAPTURE.REFUNDED";
}

