import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { capturePayPalOrder, getPayPalOrder } from "@mentorships/payments";
import { inngest } from "@/inngest/client";
import { convexServerCall } from "@/lib/convex-server-call";
import { reportError } from "@/lib/observability";

const captureSchema = z.object({
  orderId: z.string().min(1, "orderId is required"),
});

type CaptureResult =
  | { ok: true; dbOrderId: string; packId: string; captureId: string; studentEmail?: string }
  | { ok: false; status: number; error: string };

function toCents(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

/**
 * Verify that the captured PayPal order is actually the purchase we think it
 * is before any fulfilment runs.
 *
 * Checks, in order:
 *  1. the order itself is COMPLETED (a redirect is not proof of capture);
 *  2. the purchase unit carries a capture with status COMPLETED;
 *  3. the capture amount and currency equal the Convex order's total;
 *  4. the custom id resolves to that same Convex order.
 *
 * Capture is retried-safe: if PayPal reports the order is already captured
 * (a retry after a partial failure), we read the order instead of failing.
 */
async function verifyCapture(
  paypalOrderId: string,
  body: unknown
): Promise<CaptureResult> {
  const validation = captureSchema.safeParse(body);
  if (!validation.success) {
    return { ok: false, status: 400, error: "Invalid request" };
  }

  let capturedOrder;
  try {
    capturedOrder = await capturePayPalOrder(validation.data.orderId);
  } catch (captureError) {
    // An already-captured order throws (HTTP 422). Fall back to reading it so
    // a retry after a transient failure does not report a paid order as failed.
    const existing = await getPayPalOrder(validation.data.orderId).catch(() => null);
    if (existing && (existing as any)?.status === "COMPLETED") {
      capturedOrder = existing;
    } else {
      await reportError({
        source: "checkout/paypal/capture",
        error: captureError,
        message: "PayPal capture failed",
        level: "error",
        context: { paypalOrderId },
      });
      return { ok: false, status: 502, error: "Capture failed" };
    }
  }

  const orderStatus = (capturedOrder as any)?.status;
  if (orderStatus !== "COMPLETED") {
    return { ok: false, status: 409, error: "Order is not completed" };
  }

  const purchaseUnit = (capturedOrder as any)?.purchaseUnits?.[0];
  const capture = purchaseUnit?.payments?.captures?.[0];
  const captureStatus = capture?.status;
  const captureId: string | undefined = capture?.id;

  if (captureStatus !== "COMPLETED" || !captureId) {
    return { ok: false, status: 409, error: "Payment was not captured" };
  }

  // Resolve our order id from the custom id PayPal echoed back.
  const customId = purchaseUnit?.customId;
  let dbOrderId: string | undefined;
  let packId: string | undefined;
  if (typeof customId === "string") {
    try {
      const decoded = JSON.parse(customId);
      dbOrderId = typeof decoded?.orderId === "string" ? decoded.orderId : undefined;
      packId = typeof decoded?.packId === "string" ? decoded.packId : undefined;
    } catch {
      // Not our JSON shape; fall through to the missing-metadata error.
    }
  }

  if (!dbOrderId || !packId) {
    await reportError({
      source: "checkout/paypal/capture",
      error: new Error("Missing Convex order metadata in PayPal custom id"),
      message: "Captured order has no matching Convex order",
      level: "error",
      context: { paypalOrderId, captureId },
    });
    return { ok: false, status: 409, error: "Order reference missing" };
  }

  const dbOrder = await convexServerCall<any>("/orders/get-by-id-internal", {
    id: dbOrderId,
  }).catch(() => null);

  if (!dbOrder) {
    await reportError({
      source: "checkout/paypal/capture",
      error: new Error("Convex order not found for captured PayPal order"),
      message: "Captured PayPal order has no Convex order row",
      level: "error",
      context: { paypalOrderId, captureId, dbOrderId },
    });
    return { ok: false, status: 409, error: "Order reference missing" };
  }

  const capturedCents = toCents(capture?.amount?.value);
  const expectedCents = toCents(String(dbOrder.totalAmount ?? ""));
  const capturedCurrency = (capture?.amount?.currencyCode ?? "").toUpperCase();
  const expectedCurrency = String(dbOrder.currency ?? "").toUpperCase();

  if (
    capturedCents === null ||
    expectedCents === null ||
    capturedCents !== expectedCents ||
    (capturedCurrency && expectedCurrency && capturedCurrency !== expectedCurrency)
  ) {
    await reportError({
      source: "checkout/paypal/capture",
      error: new Error("Captured amount does not match the order"),
      message: "Refusing fulfilment: PayPal capture amount mismatch",
      level: "error",
      context: {
        paypalOrderId,
        captureId,
        dbOrderId,
        capturedCents,
        expectedCents,
        capturedCurrency,
        expectedCurrency,
      },
    });
    return { ok: false, status: 409, error: "Payment does not match this order" };
  }

  const payerEmail: string | undefined =
    (capturedOrder as any)?.payer?.emailAddress ||
    (capturedOrder as any)?.payer?.email_address ||
    undefined;

  return { ok: true, dbOrderId, packId, captureId, studentEmail: payerEmail };
}

/**
 * Capture a PayPal order after the buyer approves it, then hand fulfilment to
 * Inngest.
 *
 * The route is public by design (PayPal redirects the buyer's browser here
 * without a Clerk session), so it treats the PayPal order id as a capability
 * and verifies amount, currency, and status server-side before anything is
 * fulfilled. It never reports success for an approved-but-uncaptured order.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { orderId } = body as { orderId?: string };
    if (!orderId) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }

    const result = await verifyCapture(orderId, body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Fulfilment is idempotent downstream (order already paid → early return;
    // payment creation is keyed on provider + providerPaymentId), so sending
    // the event again after a capture retry is safe and desirable: the first
    // send may have been lost.
    await inngest.send({
      id: `paypal-capture-completed-${result.captureId}`,
      name: "paypal/payment.capture.completed",
      data: {
        captureId: result.captureId,
        orderId: result.dbOrderId,
        packId: result.packId,
        studentEmail: result.studentEmail,
      },
    });

    return NextResponse.json({ success: true, status: "COMPLETED" });
  } catch (error) {
    console.error("PayPal capture error:", error);
    return NextResponse.json({ error: "Capture failed" }, { status: 500 });
  }
}
