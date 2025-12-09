import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import {
  verifyPayPalWebhookSignature,
  getPayPalWebhookId,
  parsePayPalWebhookEvent,
  getPayPalOrder,
} from "@mentorships/payments";

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
        
        // PayPal capture resource doesn't include purchase_units, so we need to fetch the parent order
        // The capture has a link to the parent order in resource.links
        const links = resource.links as Array<{ rel?: string; href?: string }> | undefined;
        const orderLink = links?.find((link) => link.rel === "up");
        
        if (!orderLink?.href) {
          console.error("Missing order link in PayPal capture event");
          return NextResponse.json(
            { error: "Missing order link" },
            { status: 400 }
          );
        }

        // Extract PayPal order ID from the href (format: https://api.paypal.com/v2/checkout/orders/{ORDER_ID})
        const orderIdMatch = orderLink.href.match(/\/orders\/([^\/]+)/);
        if (!orderIdMatch) {
          console.error("Failed to extract order ID from PayPal order link");
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
          console.error("Failed to fetch PayPal order:", error);
          return NextResponse.json(
            { error: "Failed to fetch order details" },
            { status: 500 }
          );
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
        const refundId = resource.id as string;
        
        // For PAYMENT.CAPTURE.REFUNDED, resource.id is the refund ID, not the capture ID
        // The capture ID is in resource.links where rel="up"
        const links = resource.links as Array<{ rel?: string; href?: string }> | undefined;
        const captureLink = links?.find((link) => link.rel === "up");
        
        if (!captureLink?.href) {
          console.error("Missing capture link in PayPal refund event");
          return NextResponse.json(
            { error: "Missing capture link" },
            { status: 400 }
          );
        }

        // Extract capture ID from the href (format: https://api.paypal.com/v2/payments/captures/{CAPTURE_ID})
        const captureIdMatch = captureLink.href.match(/\/captures\/([^\/]+)/);
        if (!captureIdMatch) {
          console.error("Failed to extract capture ID from PayPal capture link");
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

