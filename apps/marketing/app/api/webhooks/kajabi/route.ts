import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { inngest } from "@/lib/inngest";
import { z } from "zod";
import { logInventoryChange } from "@/lib/supabase-inventory";
import { reportError } from "@/lib/observability";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
    quantity: z.number().optional(),
  }).optional(),
  payment_transaction: z.object({
    quantity: z.number().optional(),
  }).optional(),
});

type KajabiPayload = z.infer<typeof kajabiPayloadSchema>;

const offerMappingSchema = z.object({
  instructor_slug: z.string(),
  mentorship_type: z.enum(["one-on-one", "group"]),
});

type OfferMapping = z.infer<typeof offerMappingSchema>;

async function getOfferMapping(
  supabase: SupabaseClient,
  offerId: string
): Promise<OfferMapping | null> {
  const { data, error } = await supabase
    .from("kajabi_offer_mappings")
    .select("instructor_slug, mentorship_type")
    .eq("offer_id", offerId)
    .single();

  if (error || !data) {
    await reportError({
      source: "webhooks/kajabi",
      error,
      message: "Error fetching offer mapping",
      level: "error",
      context: { offerId },
    });
    return null;
  }

  const parsed = offerMappingSchema.safeParse(data);
  if (!parsed.success) {
    await reportError({
      source: "webhooks/kajabi",
      error: parsed.error,
      message: "Invalid offer mapping data",
      level: "error",
      context: { offerId, data },
    });
    return null;
  }

  return parsed.data;
}

async function getInventory(
  supabase: SupabaseClient,
  instructorSlug: string,
  type: "one-on-one" | "group"
): Promise<number | null> {
  const column = type === "one-on-one" ? "one_on_one_inventory" : "group_inventory";
  
  const { data, error } = await supabase
    .from("instructor_inventory")
    .select(column)
    .eq("instructor_slug", instructorSlug)
    .single();

  if (error || !data) {
    await reportError({
      source: "webhooks/kajabi",
      error,
      message: "Error fetching current inventory",
      level: "error",
      context: { instructorSlug, type, column },
    });
    return null;
  }

  const dataAny = data as Record<string, unknown>;
  const value = dataAny[column];
  if (typeof value !== "number") {
    await reportError({
      source: "webhooks/kajabi",
      error: new Error("Invalid inventory value"),
      message: "Invalid inventory value",
      level: "error",
      context: { instructorSlug, type, column, value },
    });
    return null;
  }

  return value;
}

async function verifyAndGetMapping(
  supabase: SupabaseClient,
  request: NextRequest,
  offerId: string
): Promise<OfferMapping | null> {
  const userAgent = request.headers.get("user-agent") || "";
  const userAgentValid = userAgent.includes("Kajabi") || userAgent.includes("kajabi");
  
  if (!userAgentValid) {
    await reportError({
      source: "webhooks/kajabi",
      error: new Error("Suspicious request - invalid User-Agent"),
      message: `Suspicious request - User-Agent: ${userAgent}`,
      level: "warn",
      context: { userAgent, offerId },
    });
    return null;
  }

  return getOfferMapping(supabase, offerId);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Server configuration error: Supabase not configured" },
      { status: 500 }
    );
  }

  try {
    const payload = await request.text();
    
    const parseResult = kajabiPayloadSchema.safeParse(JSON.parse(payload));
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

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const mapping = await verifyAndGetMapping(supabase, request, offerId);

    if (!mapping) {
      return NextResponse.json({ error: "Invalid request: offer not found or invalid User-Agent" }, { status: 400 });
    }

    const quantity = event.event === "order.created"
      ? (event.transaction?.quantity || event.payment_transaction?.quantity || 1)
      : event.event === "purchase.created" 
        ? (event.transaction?.quantity || 1)
        : (event.payment_transaction?.quantity || 1);

    const column = mapping.mentorship_type === "one-on-one" ? "one_on_one_inventory" : "group_inventory";

    const previousInventory = await getInventory(supabase, mapping.instructor_slug, mapping.mentorship_type);
    if (previousInventory === null) {
      await reportError({
        source: "webhooks/kajabi",
        error: new Error("Could not fetch current inventory before decrement"),
        message: "Could not fetch current inventory before decrement",
        level: "warn",
        context: { instructorSlug: mapping.instructor_slug, type: mapping.mentorship_type },
      });
      return NextResponse.json({ error: "Failed to get current inventory" }, { status: 500 });
    }

    const { data: decrementResult, error: rpcError } = await supabase.rpc("decrement_inventory", {
      slug_param: mapping.instructor_slug,
      inventory_column: column,
      decrement_by: quantity,
    });

    if (rpcError) {
      await reportError({
        source: "webhooks/kajabi",
        error: rpcError,
        message: "Error decrementing inventory",
        level: "error",
        context: {
          instructorSlug: mapping.instructor_slug,
          type: mapping.mentorship_type,
          quantity,
          column,
        },
      });
      return NextResponse.json({ error: "Failed to decrement inventory" }, { status: 500 });
    }

    const success = decrementResult as boolean;
    if (!success) {
      return NextResponse.json({ error: "Insufficient inventory" }, { status: 400 });
    }

    const newInventory = await getInventory(supabase, mapping.instructor_slug, mapping.mentorship_type);
    if (newInventory === null) {
      await reportError({
        source: "webhooks/kajabi",
        error: new Error("Could not determine new inventory, skipping Inngest event"),
        message: "Could not determine new inventory, skipping Inngest event",
        level: "error",
        context: {
          instructorSlug: mapping.instructor_slug,
          type: mapping.mentorship_type,
          quantity,
          previousInventory,
        },
      });
      return NextResponse.json({
        received: true,
        message: `Inventory decremented by ${quantity} (event notification skipped)`,
        instructor: mapping.instructor_slug,
        type: mapping.mentorship_type,
        quantity,
        previousInventory,
      });
    }

    await logInventoryChange({
      instructorSlug: mapping.instructor_slug,
      mentorshipType: mapping.mentorship_type,
      changeType: "kajabi_purchase",
      oldValue: previousInventory,
      newValue: newInventory,
      changedBy: `kajabi:${event.offer?.id}`,
    });

    const inngestError = await inngest.send({
      name: "inventory/changed",
      data: {
        instructorSlug: mapping.instructor_slug,
        type: mapping.mentorship_type,
        previousInventory,
        newInventory,
        quantity,
      },
    });

    if (inngestError) {
      await reportError({
        source: "webhooks/kajabi",
        error: inngestError,
        message: "Failed to send Inngest event",
        level: "error",
        context: {
          instructorSlug: mapping.instructor_slug,
          type: mapping.mentorship_type,
          previousInventory,
          newInventory,
        },
      });
    }

    return NextResponse.json({
      received: true,
      message: `Inventory decremented by ${quantity}`,
      instructor: mapping.instructor_slug,
      type: mapping.mentorship_type,
      quantity,
      previousInventory,
      newInventory,
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
