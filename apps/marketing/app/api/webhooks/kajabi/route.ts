import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { inngest } from "@/lib/inngest";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

interface KajabiPayload {
  event: string;
  offer?: {
    id: string;
    title?: string;
    internal_title?: string;
    type?: string;
  };
  member?: {
    email?: string;
    name?: string;
  };
  transaction?: {
    quantity?: number;
  };
  payment_transaction?: {
    quantity?: number;
  };
}

interface OfferMapping {
  instructor_slug: string;
  mentorship_type: "one-on-one" | "group";
}

async function getOfferMapping(supabase: SupabaseClient, offerId: string): Promise<OfferMapping | null> {
  const { data, error } = await supabase
    .from("kajabi_offer_mappings")
    .select("instructor_slug, mentorship_type")
    .eq("offer_id", offerId)
    .single();

  if (error || !data) {
    console.error("Error fetching offer mapping:", error);
    return null;
  }

  return data as OfferMapping;
}

async function getInventoryBeforeDecrement(
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
  return dataAny[column] as number;
}

async function verifyKajabiRequest(request: NextRequest, offerId: string): Promise<boolean> {
  const userAgent = request.headers.get("user-agent") || "";
  
  const userAgentValid = userAgent.includes("Kajabi") || userAgent.includes("kajabi");
  if (!userAgentValid) {
    console.warn(`Suspicious request - User-Agent: ${userAgent}`);
  }

  const supabase = createClient(supabaseUrl!, supabaseAnonKey!);
  const mapping = await getOfferMapping(supabase, offerId);
  
  return mapping !== null;
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
    const event: KajabiPayload = JSON.parse(payload);

    const relevantEvents = ["purchase.created", "payment.succeeded", "order.created"];
    if (!relevantEvents.includes(event.event)) {
      return NextResponse.json({ received: true, message: `Event type ${event.event} not processed` });
    }

    const offerId = event.offer?.id;
    if (!offerId) {
      return NextResponse.json({ error: "No offer ID in payload" }, { status: 400 });
    }

    const isValidRequest = await verifyKajabiRequest(request, offerId);
    if (!isValidRequest) {
      return NextResponse.json({ error: "Invalid request: offer not found in mappings" }, { status: 400 });
    }

    const quantity = event.event === "order.created"
      ? (event.transaction?.quantity || event.payment_transaction?.quantity || 1)
      : event.event === "purchase.created" 
        ? (event.transaction?.quantity || 1)
        : (event.payment_transaction?.quantity || 1);

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const mapping = await getOfferMapping(supabase, offerId);

    if (!mapping) {
      return NextResponse.json({ received: true, message: "Offer mapping not found" });
    }

    const previousInventory = await getInventoryBeforeDecrement(supabase, mapping.instructor_slug, mapping.mentorship_type);
    if (previousInventory === null) {
      return NextResponse.json({ error: "Failed to get current inventory" }, { status: 500 });
    }

    const column = mapping.mentorship_type === "one-on-one" ? "one_on_one_inventory" : "group_inventory";
    
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

    const newInventory = previousInventory - quantity;

    await inngest.send({
      name: "inventory/changed",
      data: {
        instructorSlug: mapping.instructor_slug,
        type: mapping.mentorship_type,
        previousInventory,
        newInventory,
        quantity,
      },
    });

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
    console.error("Error processing webhook:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
