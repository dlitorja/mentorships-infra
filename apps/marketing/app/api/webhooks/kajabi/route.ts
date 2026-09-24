import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { inngest } from "@/lib/inngest";
import { z } from "zod";
import { convexServerCall } from "@/lib/convex-server-call";
import { reportError } from "@/lib/observability";

const kajabiPayloadSchema = z.object({
  event: z.string(),
  offer: z.object({
    id: z.string(),
    title: z.string().optional(),
    internal_title: z.string().optional(),
    type: z.string().optional(),
  }).optional(),
  member: z.object({
    email: z.string().optional(),
    name: z.string().optional(),
  }).optional(),
  transaction: z.object({
    id: z.string().optional(),
    quantity: z.number().optional(),
  }).optional(),
  payment_transaction: z.object({
    id: z.string().optional(),
    quantity: z.number().optional(),
  }).optional(),
});

type KajabiPayload = z.infer<typeof kajabiPayloadSchema>;

type KajabiOfferMapping = {
  offerId: string;
  instructorSlug: string;
  mentorshipType: "one-on-one" | "group";
  kajabiOfferUrl: string;
};

type OfferLookupResult =
  | { kind: "found"; mapping: KajabiOfferMapping }
  | { kind: "not_found" }
  | { kind: "lookup_error"; cause: unknown };

async function getOfferMapping(
  offerId: string
): Promise<OfferLookupResult> {
  try {
    const response = await convexServerCall<{
      success: boolean;
      mapping: KajabiOfferMapping | null;
    }>("/kajabi-offer-mappings/lookup", { offerId });
    if (response.mapping) {
      return { kind: "found", mapping: response.mapping };
    }
    return { kind: "not_found" };
  } catch (error) {
    await reportError({
      source: "webhooks/kajabi",
      error,
      message: "Error fetching offer mapping from Convex",
      level: "error",
      context: { offerId },
    });
    return { kind: "lookup_error", cause: error };
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const payload = await request.text();

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(payload);
    } catch (jsonError) {
      await reportError({
        source: "webhooks/kajabi",
        error: jsonError,
        message: "Invalid JSON payload",
        level: "warn",
      });
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parseResult = kajabiPayloadSchema.safeParse(parsedJson);
    if (!parseResult.success) {
      await reportError({
        source: "webhooks/kajabi",
        error: parseResult.error,
        message: "Invalid webhook payload",
        level: "error",
      });
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const event = parseResult.data;
    const relevantEvents = ["purchase.created", "payment.succeeded", "order.created"];

    if (!relevantEvents.includes(event.event)) {
      return NextResponse.json({ received: true, message: `Event type ${event.event} not processed` });
    }

    const offerId = event.offer?.id;
    if (!offerId) {
      return NextResponse.json({ error: "No offer ID in payload" }, { status: 400 });
    }

    // Kajabi webhooks do not provide HMAC signature verification
    // out-of-the-box (only User-Agent matching). Until signature
    // verification is added, the User-Agent check is the only
    // forgery mitigation; an attacker that knows the offer IDs can
    // forge requests. This is acceptable for the current threat
    // model because the same forgeable requests already affected
    // the Supabase pre-PR, and a follow-up Linear issue tracks HMAC
    // verification. See `docs/post-merge/HANDOFF.md`-style docs
    // (or the Linear issue) for the security roadmap.
    const userAgent = request.headers.get("user-agent") || "";
    if (!userAgent.includes("Kajabi") && !userAgent.includes("kajabi")) {
      await reportError({
        source: "webhooks/kajabi",
        error: new Error("Suspicious request - invalid User-Agent"),
        message: `Suspicious request - User-Agent: ${userAgent}`,
        level: "warn",
        context: { userAgent, offerId },
      });
      return NextResponse.json(
        { error: "Invalid request: invalid User-Agent" },
        { status: 400 }
      );
    }

    const mappingResponse = await getOfferMapping(offerId);
    if (mappingResponse.kind === "lookup_error") {
      // Don't conflate a transient Convex outage with "offer not
      // configured". A 500 here tells Kajabi to retry the webhook
      // (correct), whereas a 404 would be treated as a permanent
      // failure.
      return NextResponse.json(
        { error: "Offer mapping lookup failed" },
        { status: 500 }
      );
    }
    if (mappingResponse.kind === "not_found") {
      return NextResponse.json(
        { error: "Offer mapping not found" },
        { status: 404 }
      );
    }
    const mapping = mappingResponse.mapping;

    const quantity = event.event === "order.created"
      ? (event.transaction?.quantity || event.payment_transaction?.quantity || 1)
      : event.event === "purchase.created"
        ? (event.transaction?.quantity || 1)
        : (event.payment_transaction?.quantity || 1);

    const convexType =
      mapping.mentorshipType === "one-on-one" ? "oneOnOne" : "group";
    const transactionId =
      event.transaction?.id ?? event.payment_transaction?.id ?? "";
    const memberEmail = event.member?.email ?? "";
    // When Kajabi omits a transaction id (e.g., test events, sandbox
    // replays, or some offer types), the canonical
    // `kajabi:<event>:<offerId>:<tx>:<email>` shape would collide
    // across distinct purchases. Fall back to a SHA-256 of the raw
    // payload so two genuinely distinct events produce distinct
    // purchaseIds, while exact-duplicate replays (same payload
    // bytes) still dedupe.
    let purchaseId: string;
    if (transactionId.length > 0 || memberEmail.length > 0) {
      purchaseId = [
        "kajabi",
        event.event,
        offerId,
        transactionId,
        memberEmail,
      ]
        .filter((part) => part !== "")
        .join(":");
    } else {
      const hash = createHash("sha256");
      hash.update(payload);
      purchaseId = `kajabi:${event.event}:${offerId}:hash:${hash.digest("hex").slice(0, 32)}`;
    }

    let alreadyApplied = false;
    let newInventory: number | null = null;
    try {
      const result = await convexServerCall<{
        success: boolean;
        alreadyApplied?: boolean;
        newValue?: number;
      }>("/inventory/apply", {
        instructorSlug: mapping.instructorSlug,
        type: convexType,
        quantity,
        changeType: "kajabi_purchase",
        source: purchaseId,
        purchaseId,
      });
      alreadyApplied = result.alreadyApplied === true;
      newInventory = result.newValue ?? null;
    } catch (applyError) {
      const message = (applyError as Error).message;
      // Insufficient inventory is a normal 4xx (Kajabi should not
      // retry); bubble up so the buyer sees an "out of stock"
      // response on the next sync.
      if (message.toLowerCase().includes("insufficient")) {
        return NextResponse.json(
          { error: "Insufficient inventory", instructor: mapping.instructorSlug, type: mapping.mentorshipType },
          { status: 400 }
        );
      }
      await reportError({
        source: "webhooks/kajabi",
        error: applyError,
        message: "Failed to apply inventory change to Convex (authoritative write)",
        level: "error",
        context: {
          instructorSlug: mapping.instructorSlug,
          type: convexType,
          quantity,
          purchaseId,
        },
      });
      return NextResponse.json(
        { error: "Failed to apply inventory change" },
        { status: 500 }
      );
    }

    if (alreadyApplied) {
      await reportError({
        source: "webhooks/kajabi",
        error: new Error(
          `Kajabi webhook replay detected for purchaseId ${purchaseId}; Convex skipped.`,
        ),
        message: `Kajabi webhook replay detected for purchaseId ${purchaseId}`,
        level: "warn",
        context: {
          instructorSlug: mapping.instructorSlug,
          type: convexType,
          quantity,
          purchaseId,
        },
      });
    }

    // Emit the inventory/changed Inngest event only on a successful
    // first-time apply so the waitlist handler doesn't fire on
    // replays or skipped writes. Inngest is best-effort: a failed
    // event send does NOT fail the webhook (Convex has already
    // committed the authoritative inventory change). If the webhook
    // returned 500 here on failure, Kajabi would retry; on retry,
    // Convex reports already-applied and the Inngest event would be
    // dropped permanently. Better to log and return success so the
    // buyer's inventory is consistent even if the waitlist
    // notification misses one cycle.
    if (!alreadyApplied && newInventory !== null) {
      try {
        const inngestSendResult = await inngest.send({
          name: "inventory/changed",
          data: {
            instructorSlug: mapping.instructorSlug,
            type: mapping.mentorshipType,
            previousInventory: newInventory + quantity,
            newInventory,
            quantity,
          },
        });
        // `inngest.send` returns either `{ ids: [...] }` on
        // success or `{ error: Error, status: number }` on failure.
        // A thrown/rejected promise is also possible.
        const failure =
          inngestSendResult &&
          typeof inngestSendResult === "object" &&
          "error" in inngestSendResult
            ? (inngestSendResult as { error: unknown }).error
            : null;
        if (failure) {
          await reportError({
            source: "webhooks/kajabi",
            error: failure,
            message:
              "Inngest send returned error result after successful Convex inventory change; waitlist notification will be missed for this cycle.",
            level: "warn",
            context: {
              instructorSlug: mapping.instructorSlug,
              type: mapping.mentorshipType,
              newInventory,
              quantity,
              purchaseId,
            },
          });
        }
      } catch (sendError) {
        await reportError({
          source: "webhooks/kajabi",
          error: sendError,
          message:
            "Inngest send threw after successful Convex inventory change; waitlist notification will be missed for this cycle.",
          level: "warn",
          context: {
            instructorSlug: mapping.instructorSlug,
            type: mapping.mentorshipType,
            newInventory,
            quantity,
            purchaseId,
          },
        });
      }
    }

    return NextResponse.json({
      received: true,
      message: `Inventory ${alreadyApplied ? "already" : ""} ${alreadyApplied ? "applied" : "decremented"} by ${quantity}`,
      instructor: mapping.instructorSlug,
      type: mapping.mentorshipType,
      quantity,
      newInventory,
      alreadyApplied,
    });
  } catch (error) {
    await reportError({
      source: "webhooks/kajabi",
      error,
      message: "Error processing webhook",
      level: "error",
    });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
