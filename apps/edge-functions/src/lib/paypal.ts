import { createVerify } from "node:crypto";
import { z } from "zod";
import type { Env } from "./env";

const paypalLinkSchema = z.object({
  rel: z.string().optional(),
  href: z.string().optional(),
});

const paymentResourceSchema = z.object({
  id: z.string(),
  links: z.array(paypalLinkSchema).optional(),
});

const paypalWebhookEnvelopeSchema = z.object({
  id: z.string(),
  event_type: z.string(),
  resource_type: z.string(),
  summary: z.string(),
  resource: z.record(z.string(), z.unknown()),
});

export type PayPalWebhookEnvelope = z.infer<typeof paypalWebhookEnvelopeSchema>;

export interface ParsedPayPalEvent {
  id: string;
  eventType: string;
  resourceType: string;
  summary: string;
  resource: Record<string, unknown>;
  metadata: {
    orderId?: string;
    packId?: string;
    captureId?: string;
  };
}

export interface PayPalOrder {
  id?: string;
  status?: string;
  purchase_units?: Array<{
    custom_id?: string;
  }>;
  payer?: {
    email_address?: string;
  };
}

/**
 * CRC32 checksum for PayPal webhook signature verification.
 */
export function crc32Checksum(body: string): number {
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
    const index = (crc ^ body.charCodeAt(i)) & 0xff;
    crc = (crcTable[index] as number) ^ (crc >>> 8);
  }

  return (crc ^ -1) >>> 0;
}

function getPayPalApiBaseUrl(env: Env): string {
  const mode = (env.PAYPAL_MODE || "sandbox").toLowerCase();
  return mode === "live" ? "https://api.paypal.com" : "https://api.sandbox.paypal.com";
}

const certCache = new Map<string, string>();
const CERT_CACHE_TTL_MS = 5 * 60 * 60 * 1000; // 5 hours

function isPayPalCertUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.endsWith(".paypal.com");
  } catch {
    return false;
  }
}

async function getCertificate(certUrl: string): Promise<string> {
  if (!isPayPalCertUrl(certUrl)) {
    throw new Error("Invalid PayPal certificate URL");
  }

  const cached = certCache.get(certUrl);
  if (cached) {
    return cached;
  }

  const response = await fetch(certUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch PayPal certificate: ${response.status}`);
  }

  const cert = await response.text();
  certCache.set(certUrl, cert);
  setTimeout(() => certCache.delete(certUrl), CERT_CACHE_TTL_MS);
  return cert;
}

/**
 * Verify a PayPal webhook signature using Node.js crypto.
 * Reference: https://developer.paypal.com/docs/api/webhooks/verify-webhook-signature/
 */
export async function verifyPayPalWebhookSignature(
  body: string,
  headers: Record<string, string | string[] | undefined>,
  webhookId: string
): Promise<boolean> {
  const normalized: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }

  const authAlgo = normalized["paypal-auth-algo"];
  const certUrl = normalized["paypal-cert-url"];
  const transmissionId = normalized["paypal-transmission-id"];
  const transmissionSig = normalized["paypal-transmission-sig"];
  const transmissionTime = normalized["paypal-transmission-time"];

  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
    throw new Error("Missing required PayPal webhook headers");
  }

  const authAlgoStr = Array.isArray(authAlgo) ? authAlgo[0] : authAlgo;
  const certUrlStr = Array.isArray(certUrl) ? certUrl[0] : certUrl;
  const transmissionIdStr = Array.isArray(transmissionId) ? transmissionId[0] : transmissionId;
  const transmissionSigStr = Array.isArray(transmissionSig) ? transmissionSig[0] : transmissionSig;
  const transmissionTimeStr = Array.isArray(transmissionTime) ? transmissionTime[0] : transmissionTime;

  if (!authAlgoStr || !certUrlStr || !transmissionIdStr || !transmissionSigStr || !transmissionTimeStr) {
    throw new Error("Missing required PayPal webhook header values");
  }

  if (!authAlgoStr.trim().startsWith("SHA256withRSA")) {
    throw new Error(`Unsupported PayPal auth algorithm: ${authAlgoStr}`);
  }

  try {
    const crc = crc32Checksum(body);
    const message = `${transmissionIdStr}|${transmissionTimeStr}|${webhookId}|${crc}`;

    const certPem = await getCertificate(certUrlStr);
    const signatureBuffer = Buffer.from(transmissionSigStr, "base64");
    const verifier = createVerify("SHA256");
    verifier.update(message);
    const isValid = verifier.verify(certPem, signatureBuffer);

    if (!isValid) {
      return false;
    }

    const parsed = JSON.parse(body);
    const validation = paypalWebhookEnvelopeSchema.safeParse(parsed);
    return validation.success;
  } catch (error) {
    console.error("PayPal webhook verification error:", error instanceof Error ? error.message : "Unknown error");
    return false;
  }
}

export function getPayPalWebhookId(env: Env): string {
  const webhookId = env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    throw new Error("PAYPAL_WEBHOOK_ID environment variable is required");
  }
  return webhookId;
}

export function parsePayPalWebhookEvent(event: {
  id: string;
  event_type: string;
  resource_type: string;
  summary: string;
  resource: Record<string, unknown>;
}): ParsedPayPalEvent {
  const resource = event.resource;
  const metadata: ParsedPayPalEvent["metadata"] = {};

  const purchaseUnits = resource.purchase_units as Array<Record<string, unknown>> | undefined;
  if (purchaseUnits && purchaseUnits.length > 0) {
    const customId = purchaseUnits[0]!.custom_id;
    if (typeof customId === "string") {
      try {
        const parsed = JSON.parse(customId) as unknown;
        if (parsed && typeof parsed === "object") {
          const obj = parsed as { orderId?: string; packId?: string };
          if (typeof obj.orderId === "string") {
            metadata.orderId = obj.orderId;
          }
          if (typeof obj.packId === "string") {
            metadata.packId = obj.packId;
          }
        } else {
          metadata.orderId = customId;
        }
      } catch {
        metadata.orderId = customId;
      }
    }
  }

  if (
    event.event_type === "PAYMENT.CAPTURE.COMPLETED" ||
    event.event_type === "PAYMENT.CAPTURE.REFUNDED"
  ) {
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
    resource,
    metadata,
  };
}

export { paymentResourceSchema };

/**
 * Fetch a PayPal access token via OAuth2 client credentials.
 */
async function getPayPalAccessToken(env: Env): Promise<string> {
  const baseUrl = getPayPalApiBaseUrl(env);
  const credentials = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch PayPal access token: ${response.status}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("PayPal access token response missing access_token");
  }
  return data.access_token;
}

/**
 * Fetch a PayPal order by ID using the REST API.
 */
export async function getPayPalOrder(orderId: string, env: Env): Promise<PayPalOrder> {
  const baseUrl = getPayPalApiBaseUrl(env);
  const accessToken = await getPayPalAccessToken(env);

  const response = await fetch(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch PayPal order: ${response.status}`);
  }

  return (await response.json()) as PayPalOrder;
}
