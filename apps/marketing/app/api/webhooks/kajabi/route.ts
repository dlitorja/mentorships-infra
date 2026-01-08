import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { inngest } from "@/lib/inngest";
import { z } from "zod";
import { logInventoryChange } from "@/lib/supabase-inventory";

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
    console.error("Error fetching offer mapping:", error);
    return null;
  }

  const parsed = offerMappingSchema.safeParse(data);
  if (!parsed.success) {
    console.error("Invalid offer mapping data:", parsed.error.format());
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
    console.error("Error fetching current inventory:", error);
    return null;
  }

  const dataAny = data as Record<string, unknown>;
  const value = dataAny[column];
  if (typeof value !== "number") {
    console.error("Invalid inventory value:", value);
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
    console.warn(`Suspicious request - User-Agent: ${userAgent}`);
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
      console.error("Invalid webhook payload:", parseResult.error.format());
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
      console.warn("Could not fetch current inventory before decrement");
      return NextResponse.json({ error: "Failed to get current inventory" }, { status: 500 });
    }

    const { data: decrementResult, error: rpcError } = await supabase.rpc("decrement_inventory", {
      slug_param: mapping.instructor_slug,
      inventory_column: column,
      decrement_by: quantity,
    });

    if (rpcError) {
      console.error("Error decrementing inventory:", rpcError);
      return NextResponse.json({ error: "Failed to decrement inventory" }, { status: 500 });
    }

    const success = decrementResult as boolean;
    if (!success) {
      return NextResponse.json({ error: "Insufficient inventory" }, { status: 400 });
    }

    await logInventoryChange({
      instructorSlug: mapping.instructor_slug,
      mentorshipType: mapping.mentorship_type,
      changeType: "kajabi_purchase",
      oldValue: previousInventory,
      newValue: previousInventory - quantity,
      changedBy: `kajabi:${event.offer?.id}`,
    });

    const newInventory = await getInventory(supabase, mapping.instructor_slug, mapping.mentorship_type);
    if (newInventory === null) {
      console.warn("Could not fetch new inventory after decrement, using calculated value");
    }

    const finalNewInventory = newInventory !== null ? newInventory : -1;

    const inngestError = await inngest.send({
      name: "inventory/changed",
      data: {
        instructorSlug: mapping.instructor_slug,
        type: mapping.mentorship_type,
        previousInventory,
        newInventory: finalNewInventory,
        quantity,
      },
    });

    if (inngestError) {
      console.error("Failed to send Inngest event:", inngestError);
    }

    return NextResponse.json({
      received: true,
      message: `Inventory decremented by ${quantity}`,
      instructor: mapping.instructor_slug,
      type: mapping.mentorship_type,
      quantity,
      previousInventory,
      newInventory: finalNewInventory,
    });
  } catch (error) {
    console.error("Error processing webhook:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
