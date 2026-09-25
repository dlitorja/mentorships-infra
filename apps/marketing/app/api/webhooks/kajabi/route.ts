import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { inngest } from "@/lib/inngest";
import { z } from "zod";
import { convexServerCall } from "@/lib/convex-server-call";
import { reportError } from "@/lib/observability";
import { getIp } from "@/lib/ratelimit";

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

/** Recursively serializes `value` to JSON with object keys sorted
 * alphabetically at every depth. Produces a canonical form so
 * equivalent payloads (whitespace, property order, missing
 * defaults) hash identically. Used as the input to the
 * transaction-id-less replay-key SHA-256.
 */
function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJsonStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    parts.push(JSON.stringify(key) + ":" + canonicalJsonStringify(obj[key]));
  }
  return "{" + parts.join(",") + "}";
}

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
  // Forgeable auth: the only auth on this endpoint is the User-Agent
  // check below — Kajabi does not publish HMAC signing for outbound
  // webhooks (verified 2026-09-24 against help.kajabi.com +
  // api-reference/webhooks/create-hook.md). The compensating
  // controls, in order of effectiveness:
  //
  //   1. Per-IP rate limit, applied in `apps/marketing/proxy.ts`
  //      before this handler runs. The `webhook` policy in
  //      `lib/ratelimit.ts` is 10 req / 60s sliding-window per IP.
  //      Sustained forgery bursts (>10 attempts in 60s from one IP)
  //      are rejected with 429 by the proxy before any payload
  //      parsing or Convex call. `protectWithRateLimit` also emits a
  //      `reportError` event with `source = "ratelimit.middleware"`
  //      and the source IP in `context`, so 429s are observable in
  //      BetterStack / Axiom. Kajabi's legitimate traffic is bursty
  //      but rare (1–5 events per purchase, well below the 10/60s
  //      ceiling).
  //   2. User-Agent anomaly alerting. Invalid-UA rejections emit a
  //      `reportError({ source: "webhooks/kajabi", level: "warn",
  //      message: "Suspicious request …" })` event with the source
  //      IP in `context`, flowing to BetterStack + Axiom (when
  //      configured). Operators can alert on `source =
  //      "webhooks/kajabi"` AND `level = "warn"` AND `message
  //      CONTAINS "Suspicious request"` AND `context.ip` count > N
  //      per minute. See `docs/post-merge/kajabi-webhook-security.md`
  //      for the runbook.
  //
  // Threat model after these controls:
  //   - An attacker who knows the offer IDs can still forge single
  //     requests with `User-Agent: Kajabi/...`, each of which can
  //     decrement inventory by `quantity` units (default 1, but the
  //     schema accepts any positive integer up to the available
  //     stock — a single forged request can therefore exhaust an
  //     offer). The 10/60s rate limit bounds the REQUEST volume to
  //     ~10 requests/IP/min — but the per-request damage is bounded
  //     only by the offer's remaining inventory, not by the rate
  //     limit. Operators should monitor inventory-change volume per
  //     instructor per hour to detect single-request exhausts.
  //   - The attacker cannot mint real transactions, steal money, or
  //     exfiltrate customer data.
  //
  // If Kajabi support later confirms HMAC signing is available,
  // replace both controls with signature verification (see HUC-44,
  // which was canceled for the original premise).
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

    const userAgent = request.headers.get("user-agent") || "";
    if (!userAgent.includes("Kajabi") && !userAgent.includes("kajabi")) {
      // Capture the source IP so operators can configure per-IP
      // alerts. `getIp` from `lib/ratelimit.ts` reads Vercel's
      // trusted edge header `x-vercel-forwarded-for` first and only
      // falls back to client-spoofable headers (cf-connecting-ip,
      // x-forwarded-for, x-real-ip) when no trusted edge is in front
      // of the deployment. Sharing this helper with the
      // rate-limiter ensures the IP used here matches the IP that
      // the rate-limiter buckets by, so per-IP alerts on
      // `source = "webhooks/kajabi"` and `source =
      // "ratelimit.middleware"` pivot to the same IP address space.
      await reportError({
        source: "webhooks/kajabi",
        error: new Error("Suspicious request - invalid User-Agent"),
        message: `Suspicious request - User-Agent: ${userAgent}`,
        level: "warn",
        context: { userAgent, offerId, ip: getIp(request) },
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
    // Kajabi's canonical transaction id is the only field that
    // uniquely identifies a single purchase. When it is missing
    // (e.g., test events, sandbox replays, or some offer types),
    // the composite purchaseId would collide across distinct
    // purchases of the same offer by the same member. Fall back to
    // a SHA-256 of a CANONICALIZED JSON serialization of the
    // payload (object keys sorted recursively) so two genuinely
    // distinct events produce distinct purchaseIds AND equivalent
    // JSON redeliveries (with whitespace/ordering differences) get
    // the same hash and dedupe correctly.
    let purchaseId: string;
    if (transactionId.length > 0) {
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
      const canonical = canonicalJsonStringify(parsedJson);
      const hash = createHash("sha256");
      hash.update(canonical);
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
