import type { ParsedPayPalEvent, PayPalWebhookEventType } from "./types";
import { getPayPalClient } from "./client";
import { NotificationsController } from "@paypal/paypal-server-sdk";

/**
 * Verify PayPal webhook signature
 * 
 * PayPal webhook verification uses PayPal's verification API endpoint
 * which validates:
 * 1. The webhook signature header
 * 2. The certificate chain
 * 3. The payload integrity
 * 
 * This is the recommended approach by PayPal for production use.
 * 
 * @param body - Raw request body as string
 * @param headers - Request headers (must include PayPal webhook headers)
 * @param webhookId - PayPal webhook ID (from PayPal dashboard)
 * @returns true if signature is valid
 * @throws Error if verification fails or headers are missing
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

  // Validate all required headers are present
  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
    throw new Error("Missing required PayPal webhook headers");
  }

  // Ensure all headers are strings (not arrays)
  const authAlgoStr = Array.isArray(authAlgo) ? authAlgo[0] : authAlgo;
  const certUrlStr = Array.isArray(certUrl) ? certUrl[0] : certUrl;
  const transmissionIdStr = Array.isArray(transmissionId) ? transmissionId[0] : transmissionId;
  const transmissionSigStr = Array.isArray(transmissionSig) ? transmissionSig[0] : transmissionSig;
  const transmissionTimeStr = Array.isArray(transmissionTime) ? transmissionTime[0] : transmissionTime;

  // Validate headers are non-empty
  if (!authAlgoStr?.trim() || !certUrlStr?.trim() || !transmissionIdStr?.trim() || 
      !transmissionSigStr?.trim() || !transmissionTimeStr?.trim()) {
    return false;
  }

  try {
    // Parse the webhook event to get the event ID
    const event = JSON.parse(body);
    const eventId = event.id;

    if (!eventId) {
      console.error("PayPal webhook event missing ID");
      return false;
    }

    // Use PayPal's verification API to verify the webhook signature
    // This is the recommended approach by PayPal
    const client = getPayPalClient();
    const notificationsController = new NotificationsController(client);

    const verificationResponse = await notificationsController.verifyWebhookSignature({
      body: {
        auth_algo: authAlgoStr,
        cert_url: certUrlStr,
        transmission_id: transmissionIdStr,
        transmission_sig: transmissionSigStr,
        transmission_time: transmissionTimeStr,
        webhook_id: webhookId,
        webhook_event: event,
      },
    });

    // Check if verification was successful
    if (verificationResponse.statusCode !== 200) {
      console.error(
        `PayPal webhook verification failed: ${verificationResponse.statusCode}`,
        verificationResponse.result
      );
      return false;
    }

    const verificationResult = verificationResponse.result;
    
    // PayPal returns verification_status: "SUCCESS" if valid
    if (verificationResult?.verification_status === "SUCCESS") {
      return true;
    }

    // Log the reason for failure if available
    if (verificationResult?.verification_status) {
      console.error(
        `PayPal webhook verification failed: ${verificationResult.verification_status}`,
        verificationResult
      );
    }

    return false;
  } catch (error) {
    // Log the error but don't expose internal details
    console.error("PayPal webhook verification error:", error instanceof Error ? error.message : "Unknown error");
    return false;
  }
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
      try {
        const parsed = JSON.parse(customId);
        if (parsed && typeof parsed === "object") {
          const obj = parsed as { orderId?: string; packId?: string };
          if (typeof obj.orderId === "string") {
            metadata.orderId = obj.orderId;
          }
          if (typeof obj.packId === "string") {
            metadata.packId = obj.packId;
          }
        } else {
          // Fallback for legacy plain-string custom_id
          metadata.orderId = customId;
        }
      } catch {
        // Fallback if custom_id is not JSON
        metadata.orderId = customId;
      }
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

