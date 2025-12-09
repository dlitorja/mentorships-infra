import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import {
  verifyPayPalWebhookSignature,
  getPayPalWebhookId,
  parsePayPalWebhookEvent,
} from "@mentorships/payments";
import { getOrderById } from "@mentorships/db";

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
      console.error("PayPal webhook signature verification failed");
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    // Parse webhook event
    const event = JSON.parse(body);
    const parsedEvent = parsePayPalWebhookEvent(event);

    if (!parsedEvent) {
      console.error("Failed to parse PayPal webhook event");
      return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    }

    // Handle different event types
    switch (parsedEvent.eventType) {
      case "PAYMENT.CAPTURE.COMPLETED": {
        const resource = parsedEvent.resource as Record<string, unknown>;
        const captureId = resource.id as string;
        const purchaseUnits = resource.purchase_units as Array<Record<string, unknown>> | undefined;
        
        // Extract order_id and packId from custom_id in purchase_units
        // custom_id is JSON-encoded: { orderId, packId }
        let orderId: string | undefined;
        let packId: string | undefined;
        
        if (purchaseUnits && purchaseUnits.length > 0) {
          const customId = purchaseUnits[0].custom_id;
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

        if (!orderId) {
          console.error("Missing order_id in PayPal capture event");
          return NextResponse.json(
            { error: "Missing order_id" },
            { status: 400 }
          );
        }

        if (!packId) {
          console.error("Missing pack_id in PayPal capture event");
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

        console.log(`Sent PAYMENT.CAPTURE.COMPLETED event to Inngest for order ${orderId}`);
        return NextResponse.json({ received: true, eventId: parsedEvent.id });
      }

      case "PAYMENT.CAPTURE.REFUNDED": {
        const resource = parsedEvent.resource as Record<string, unknown>;
        const captureId = resource.id as string;

        // Send event to Inngest for processing
        await inngest.send({
          name: "paypal/payment.capture.refunded",
          data: {
            captureId,
          },
        });

        console.log(`Sent PAYMENT.CAPTURE.REFUNDED event to Inngest for capture ${captureId}`);
        return NextResponse.json({ received: true, eventId: parsedEvent.id });
      }

      default:
        console.log(`Unhandled PayPal event type: ${parsedEvent.eventType}`);
        return NextResponse.json({ received: true });
    }
  } catch (error) {
    console.error("PayPal webhook processing error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}

// Disable body parsing (PayPal needs raw body for signature verification)
export const runtime = "nodejs";

