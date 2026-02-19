import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { inngest } from "@/inngest/client";
import {
  verifyPayPalWebhookSignature,
  getPayPalWebhookId,
  parsePayPalWebhookEvent,
  getPayPalOrder,
} from "@mentorships/payments";
import { reportError, reportInfo } from "@/lib/observability";

const paypalLinkSchema = z.object({
  rel: z.string().optional(),
  href: z.string().optional(),
});

const captureResourceSchema = z.object({
  id: z.string(),
  links: z.array(paypalLinkSchema).optional(),
});

const refundResourceSchema = z.object({
  id: z.string(),
  links: z.array(paypalLinkSchema).optional(),
});

/**
 * Webhook handler that verifies PayPal signatures and sends events to Inngest
 * Inngest handles all processing with automatic retries, idempotency, and error handling
 */

export async function POST(req: NextRequest) {
  const body = await req.text();
  const headers: Record<string, string | string[] | undefined> = {};
  
  // Convert headers to plain object
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  try {
    // Verify webhook signature
    const webhookId = getPayPalWebhookId();
    const isValid = await verifyPayPalWebhookSignature(body, headers, webhookId);

    if (!isValid) {
      await reportError({
        source: "webhooks/paypal",
        error: new Error("PayPal webhook signature verification failed"),
        message: "PayPal webhook signature verification failed",
        level: "error",
      });
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    // Parse webhook event
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(body);
    } catch (jsonError) {
      await reportError({
        source: "webhooks/paypal",
        error: jsonError,
        message: "Invalid JSON payload",
        level: "warn",
      });
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // parsePayPalWebhookEvent performs its own validation; the Zod schemas below validate resource shape at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsedEvent = parsePayPalWebhookEvent(parsedJson as any);

    if (!parsedEvent) {
      await reportError({
        source: "webhooks/paypal",
        error: new Error("Failed to parse PayPal webhook event"),
        message: "Failed to parse PayPal webhook event",
        level: "error",
      });
      return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    }

    // Handle different event types
    switch (parsedEvent.eventType) {
      case "PAYMENT.CAPTURE.COMPLETED": {
        const resourceResult = captureResourceSchema.safeParse(parsedEvent.resource);
        if (!resourceResult.success) {
          await reportError({
            source: "webhooks/paypal",
            error: resourceResult.error,
            message: "Invalid resource shape in PAYMENT.CAPTURE.COMPLETED",
            level: "error",
          });
          return NextResponse.json({ error: "Invalid event resource" }, { status: 400 });
        }

        const { id: captureId, links } = resourceResult.data;
        const orderLink = links?.find((link) => link.rel === "up");
        
        if (!orderLink?.href) {
          await reportError({
            source: "webhooks/paypal",
            error: new Error("Missing order link in PayPal capture event"),
            message: "Missing order link in PayPal capture event",
            level: "error",
            context: { captureId, eventId: parsedEvent.id },
          });
          return NextResponse.json(
            { error: "Missing order link" },
            { status: 400 }
          );
        }

        // Extract PayPal order ID from the href (format: https://api.paypal.com/v2/checkout/orders/{ORDER_ID})
        const orderIdMatch = orderLink.href.match(/\/orders\/([^\/]+)/);
        if (!orderIdMatch) {
          await reportError({
            source: "webhooks/paypal",
            error: new Error("Failed to extract order ID from PayPal order link"),
            message: "Failed to extract order ID from PayPal order link",
            level: "error",
            context: { orderLink: orderLink.href, eventId: parsedEvent.id },
          });
          return NextResponse.json(
            { error: "Invalid order link format" },
            { status: 400 }
          );
        }
        const paypalOrderId = orderIdMatch[1];

        // Fetch the parent order to get custom_id from purchase_units
        let orderId: string | undefined;
        let packId: string | undefined;
        
        try {
          const paypalOrder = await getPayPalOrder(paypalOrderId);
          const purchaseUnits = paypalOrder.purchaseUnits;
          
          if (purchaseUnits && purchaseUnits.length > 0) {
            const customId = purchaseUnits[0].customId;
            if (typeof customId === "string") {
              try {
                const decoded = JSON.parse(customId);
                orderId = decoded.orderId;
                packId = decoded.packId;
              } catch {
                // Fallback: if not JSON, assume it's just orderId (legacy)
                orderId = customId;
              }
            }
          }
        } catch (error) {
          await reportError({
            source: "webhooks/paypal",
            error,
            message: "Failed to fetch PayPal order",
            level: "error",
            context: { paypalOrderId, eventId: parsedEvent.id },
          });
          return NextResponse.json(
            { error: "Failed to fetch order details" },
            { status: 500 }
          );
        }

        if (!orderId) {
          await reportError({
            source: "webhooks/paypal",
            error: new Error("Missing order_id in PayPal capture event"),
            message: "Missing order_id in PayPal capture event",
            level: "error",
            context: { captureId, eventId: parsedEvent.id },
          });
          return NextResponse.json(
            { error: "Missing order_id" },
            { status: 400 }
          );
        }

        if (!packId) {
          await reportError({
            source: "webhooks/paypal",
            error: new Error("Missing pack_id in PayPal capture event"),
            message: "Missing pack_id in PayPal capture event",
            level: "error",
            context: { orderId, captureId, eventId: parsedEvent.id },
          });
          return NextResponse.json(
            { error: "Missing pack_id" },
            { status: 400 }
          );
        }
        
        // Send event to Inngest for processing
        await inngest.send({
          name: "paypal/payment.capture.completed",
          data: {
            captureId,
            orderId,
            packId,
          },
        });

        await reportInfo({
          source: "webhooks/paypal",
          message: `Sent PAYMENT.CAPTURE.COMPLETED event to Inngest for order ${orderId}`,
          context: { orderId, packId, captureId, eventId: parsedEvent.id },
        });
        return NextResponse.json({ received: true, eventId: parsedEvent.id });
      }

      case "PAYMENT.CAPTURE.REFUNDED": {
        const resourceResult = refundResourceSchema.safeParse(parsedEvent.resource);
        if (!resourceResult.success) {
          await reportError({
            source: "webhooks/paypal",
            error: resourceResult.error,
            message: "Invalid resource shape in PAYMENT.CAPTURE.REFUNDED",
            level: "error",
          });
          return NextResponse.json({ error: "Invalid event resource" }, { status: 400 });
        }

        const { id: refundId, links } = resourceResult.data;
        const captureLink = links?.find((link) => link.rel === "up");
        
        if (!captureLink?.href) {
          await reportError({
            source: "webhooks/paypal",
            error: new Error("Missing capture link in PayPal refund event"),
            message: "Missing capture link in PayPal refund event",
            level: "error",
            context: { refundId, eventId: parsedEvent.id },
          });
          return NextResponse.json(
            { error: "Missing capture link" },
            { status: 400 }
          );
        }

        // Extract capture ID from the href (format: https://api.paypal.com/v2/payments/captures/{CAPTURE_ID})
        const captureIdMatch = captureLink.href.match(/\/captures\/([^\/]+)/);
        if (!captureIdMatch) {
          await reportError({
            source: "webhooks/paypal",
            error: new Error("Failed to extract capture ID from PayPal capture link"),
            message: "Failed to extract capture ID from PayPal capture link",
            level: "error",
            context: { captureLink: captureLink.href, eventId: parsedEvent.id },
          });
          return NextResponse.json(
            { error: "Invalid capture link format" },
            { status: 400 }
          );
        }
        const captureId = captureIdMatch[1];

        // Send event to Inngest for processing
        await inngest.send({
          name: "paypal/payment.capture.refunded",
          data: {
            captureId,
            refundId,
          },
        });

        await reportInfo({
          source: "webhooks/paypal",
          message: `Sent PAYMENT.CAPTURE.REFUNDED event to Inngest for capture ${captureId}`,
          context: { captureId, refundId, eventId: parsedEvent.id },
        });
        return NextResponse.json({ received: true, eventId: parsedEvent.id });
      }

      default:
        await reportInfo({
          source: "webhooks/paypal",
          message: `Unhandled PayPal event type: ${parsedEvent.eventType}`,
          context: { eventType: parsedEvent.eventType, eventId: parsedEvent.id },
        });
        return NextResponse.json({ received: true });
    }
  } catch (error) {
    await reportError({
      source: "webhooks/paypal",
      error,
      message: "PayPal webhook processing error",
      level: "error",
    });
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}

// Disable body parsing (PayPal needs raw body for signature verification)
export const runtime = "nodejs";

