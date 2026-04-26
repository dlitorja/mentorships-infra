import type { ParsedPayPalEvent, PayPalWebhookEventType } from "./types";
import { z, ZodError } from "zod";
import crypto from "node:crypto";

/**
 * CRC32 checksum calculation for webhook signature verification
 * @param body - Raw request body
 * @returns CRC32 checksum as decimal number
 */
function crc32Checksum(body: string): number {
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c;
  }
  
  let crc = 0 ^ -1;
  for (let i = 0; i < body.length; i++) {
    crc = crcTable[(crc ^ body.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
  }
  
  return (crc ^ -1) >>> 0;
}

// Certificate cache for signature verification
const certCache: Map<string, { cert: string; expiresAt: number }> = new Map();
const CERT_CACHE_TTL_MS = 5 * 60 * 60 * 1000; // 5 hours

/**
 * Get PayPal mode from environment
 * @returns "sandbox" or "live"
 */
function getPayPalMode(): string {
  return (process.env.PAYPAL_MODE || "sandbox").toLowerCase();
}

/**
 * Get PayPal API base URL based on mode
 * @returns API base URL
 */
function getPayPalApiBaseUrl(): string {
  const mode = getPayPalMode();
  return mode === "live" 
    ? "https://api.paypal.com" 
    : "https://api.sandbox.paypal.com";
}

/**
 * Fetch and cache PayPal certificate
 * Caches certificate for 5 hours to avoid repeated fetches
 * @param certUrl - Certificate URL from PayPal webhook headers
 * @returns Cached or fetched certificate as PEM string
 */
async function getCertificate(certUrl: string): Promise<string> {
  const cached = certCache.get(certUrl);
  const now = Date.now();
  
  if (cached && cached.expiresAt > now) {
    return cached.cert;
  }
  
  // Fetch new certificate
  const response = await fetch(certUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch PayPal certificate: ${response.status}`);
  }
  
  const cert = await response.text();
  
  // Cache with TTL
  certCache.set(certUrl, {
    cert,
    expiresAt: now + CERT_CACHE_TTL_MS,
  });
  
  return cert;
}

/**
 * Zod schema for validating PayPal webhook event structure
 * At minimum, events must have an id field
 */
const PayPalWebhookEventSchema = z.object({
  id: z.string(),
  event_type: z.string(),
  resource_type: z.string(),
  summary: z.string(),
  resource: z.record(z.string(), z.unknown()),
});

type PayPalWebhookEvent = z.infer<typeof PayPalWebhookEventSchema>;

/**
 * Verify PayPal webhook signature using cryptographic verification
 * 
 * This implements full signature verification:
 * 1. Constructs the original message string from headers
 * 2. Downloads the PayPal certificate
 * 3. Verifies the signature using SHA256
 * 
 * Reference: https://developer.paypal.com/docs/api/webhooks/verify-webhook-signature/
 * 
 * @param body - Raw request body as string
 * @param headers - Request headers (must include PayPal webhook headers)
 * @param webhookId - PayPal webhook ID (from PayPal dashboard)
 * @returns true if signature is valid
 * @throws Error if headers are missing or verification fails
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

  // Validate headers are non-empty - throw error for consistency
  if (!authAlgoStr?.trim()) {
    throw new Error("PAYPAL-AUTH-ALGO header is empty");
  }
  if (!certUrlStr?.trim()) {
    throw new Error("PAYPAL-CERT-URL header is empty");
  }
  if (!transmissionIdStr?.trim()) {
    throw new Error("PAYPAL-TRANSMISSION-ID header is empty");
  }
  if (!transmissionSigStr?.trim()) {
    throw new Error("PAYPAL-TRANSMISSION-SIG header is empty");
  }
  if (!transmissionTimeStr?.trim()) {
    throw new Error("PAYPAL-TRANSMISSION-TIME header is empty");
  }

  try {
    // Step 1: Calculate CRC32 of the raw body
    const crc = crc32Checksum(body);

    // Step 2: Construct the original message string
    // Format: transmissionId|transmissionTime|webhookId|crc32
    const message = `${transmissionIdStr}|${transmissionTimeStr}|${webhookId}|${crc}`;
    console.log(`PayPal verification message: ${message}`);

    // Step 3: Get the certificate (cached or fetch)
    const certPem = await getCertificate(certUrlStr);

    // Step 4: Verify the signature
    const signatureBuffer = Buffer.from(transmissionSigStr, "base64");
    const verifier = crypto.createVerify("SHA256");
    verifier.update(message);
    
    const isValid = verifier.verify(certPem, signatureBuffer);
    
    if (!isValid) {
      console.error("PayPal webhook signature verification FAILED");
      return false;
    }

    console.log("PayPal webhook signature verified successfully");
    
    // Step 5: Validate webhook event structure using Zod
    const parsed = JSON.parse(body);
    const validation = PayPalWebhookEventSchema.safeParse(parsed);
    if (!validation.success) {
      console.error(
        "PayPal webhook event validation failed:",
        validation.error.issues
      );
      return false;
    }

    return true;
  } catch (error) {
    // Log error but don't expose internal details
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
