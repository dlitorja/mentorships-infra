import type { Env } from "../../lib/env";
import { createInngestClient } from "../../lib/inngest";
import { logError, logInfo } from "../../lib/observability";
import {
  getPayPalOrder,
  getPayPalWebhookId,
  parsePayPalWebhookEvent,
  paymentResourceSchema,
  verifyPayPalWebhookSignature,
  type PayPalWebhookEnvelope,
} from "../../lib/paypal";

/**
 * POST /webhooks/paypal
 * Worker-side port of apps/platform/app/api/webhooks/paypal/route.ts.
 * Verifies PayPal webhook signature and forwards capture/refund events to Inngest.
 */
export async function handlePayPalWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  const source = "webhooks/paypal";

  const body = await request.text();
  const headers: Record<string, string | string[] | undefined> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  try {
    const webhookId = getPayPalWebhookId(env);
    const isValid = await verifyPayPalWebhookSignature(body, headers, webhookId);

    if (!isValid) {
      logError(source, new Error("PayPal webhook signature verification failed"), "PayPal webhook signature verification failed");
      return json({ error: "Invalid signature" }, 400);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(body);
    } catch (jsonError) {
      logError(source, jsonError, "Invalid JSON payload");
      return json({ error: "Invalid JSON" }, 400);
    }

    const envelopeResult = parsePayPalWebhookEnvelope(parsedJson);
    if (!envelopeResult) {
      logError(source, new Error("Invalid event envelope shape"), "Invalid event envelope shape");
      return json({ error: "Invalid event" }, 400);
    }

    const parsedEvent = parsePayPalWebhookEvent(envelopeResult);
    const inngest = createInngestClient(env);

    switch (parsedEvent.eventType) {
      case "PAYMENT.CAPTURE.COMPLETED": {
        const resourceResult = paymentResourceSchema.safeParse(parsedEvent.resource);
        if (!resourceResult.success) {
          logError(source, resourceResult.error, "Invalid resource shape in PAYMENT.CAPTURE.COMPLETED");
          return json({ error: "Invalid event resource" }, 400);
        }

        const { id: captureId, links } = resourceResult.data;
        const orderLink = links?.find((link) => link.rel === "up");

        if (!orderLink?.href) {
          logError(source, new Error("Missing order link in PayPal capture event"), "Missing order link in PayPal capture event", {
            captureId,
            eventId: parsedEvent.id,
          });
          return json({ error: "Missing order link" }, 400);
        }

        const orderIdMatch = orderLink.href.match(/\/orders\/([^/]+)/);
        if (!orderIdMatch) {
          logError(source, new Error("Failed to extract order ID from PayPal order link"), "Failed to extract order ID from PayPal order link", {
            orderLink: orderLink.href,
            eventId: parsedEvent.id,
          });
          return json({ error: "Invalid order link format" }, 400);
        }
        const paypalOrderId = orderIdMatch[1] as string;

        let paypalOrder: { purchase_units?: Array<{ custom_id?: string }>; payer?: { email_address?: string } } | undefined;
        let orderId: string | undefined;
        let packId: string | undefined;

        try {
          paypalOrder = await getPayPalOrder(paypalOrderId, env);
          const purchaseUnits = paypalOrder.purchase_units;
          if (purchaseUnits && purchaseUnits.length > 0) {
            const customId = purchaseUnits[0]!.custom_id;
            if (typeof customId === "string") {
              try {
                const decoded = JSON.parse(customId) as { orderId?: string; packId?: string };
                orderId = decoded.orderId;
                packId = decoded.packId;
              } catch {
                orderId = customId;
              }
            }
          }
        } catch (error) {
          logError(source, error, "Failed to fetch PayPal order", {
            paypalOrderId,
            eventId: parsedEvent.id,
          });
          return json({ error: "Failed to fetch order details" }, 500);
        }

        if (!orderId || !packId) {
          logError(source, new Error("Missing order_id or pack_id in PayPal capture event"), "Missing order_id or pack_id in PayPal capture event", {
            orderId,
            packId,
            captureId,
            eventId: parsedEvent.id,
          });
          return json({ error: "Missing order_id or pack_id" }, 400);
        }

        await inngest.send({
          id: `paypal-capture-completed-${captureId}`,
          name: "paypal/payment.capture.completed",
          data: {
            captureId,
            orderId,
            packId,
            studentEmail: paypalOrder.payer?.email_address,
          },
        });

        logInfo(source, `Sent PAYMENT.CAPTURE.COMPLETED event to Inngest for order ${orderId}`, {
          orderId,
          packId,
          captureId,
          eventId: parsedEvent.id,
        });
        return json({ received: true, eventId: parsedEvent.id });
      }

      case "PAYMENT.CAPTURE.REFUNDED": {
        const resourceResult = paymentResourceSchema.safeParse(parsedEvent.resource);
        if (!resourceResult.success) {
          logError(source, resourceResult.error, "Invalid resource shape in PAYMENT.CAPTURE.REFUNDED");
          return json({ error: "Invalid event resource" }, 400);
        }

        const { id: refundId, links } = resourceResult.data;
        const captureLink = links?.find((link) => link.rel === "up");

        if (!captureLink?.href) {
          logError(source, new Error("Missing capture link in PayPal refund event"), "Missing capture link in PayPal refund event", {
            refundId,
            eventId: parsedEvent.id,
          });
          return json({ error: "Missing capture link" }, 400);
        }

        const captureIdMatch = captureLink.href.match(/\/captures\/([^/]+)/);
        if (!captureIdMatch) {
          logError(source, new Error("Failed to extract capture ID from PayPal capture link"), "Failed to extract capture ID from PayPal capture link", {
            captureLink: captureLink.href,
            eventId: parsedEvent.id,
          });
          return json({ error: "Invalid capture link format" }, 400);
        }
        const captureId = captureIdMatch[1];

        await inngest.send({
          id: `paypal-capture-refunded-${refundId}`,
          name: "paypal/payment.capture.refunded",
          data: {
            captureId,
            refundId,
          },
        });

        logInfo(source, `Sent PAYMENT.CAPTURE.REFUNDED event to Inngest for capture ${captureId}`, {
          captureId,
          refundId,
          eventId: parsedEvent.id,
        });
        return json({ received: true, eventId: parsedEvent.id });
      }

      default:
        logInfo(source, `Unhandled PayPal event type: ${parsedEvent.eventType}`, {
          eventType: parsedEvent.eventType,
          eventId: parsedEvent.id,
        });
        return json({ received: true });
    }
  } catch (error) {
    logError(source, error, "PayPal webhook processing error");
    return json({ error: "Webhook processing failed" }, 500);
  }
}

function parsePayPalWebhookEnvelope(parsedJson: unknown): PayPalWebhookEnvelope | null {
  if (typeof parsedJson !== "object" || parsedJson === null) {
    return null;
  }
  const obj = parsedJson as Record<string, unknown>;

  if (
    typeof obj.id !== "string" ||
    typeof obj.event_type !== "string" ||
    typeof obj.resource_type !== "string" ||
    typeof obj.summary !== "string" ||
    typeof obj.resource !== "object" ||
    obj.resource === null
  ) {
    return null;
  }

  return {
    id: obj.id,
    event_type: obj.event_type,
    resource_type: obj.resource_type,
    summary: obj.summary,
    resource: obj.resource as Record<string, unknown>,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
