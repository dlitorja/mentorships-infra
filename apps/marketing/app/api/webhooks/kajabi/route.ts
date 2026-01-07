import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const kajabiApiKey = process.env.KAJABI_API_KEY;
const kajabiApiSecret = process.env.KAJABI_API_SECRET;
const webhookToken = process.env.KAJABI_WEBHOOK_TOKEN;

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

async function getOfferMapping(supabase: any, offerId: string) {
  const { data, error } = await supabase
    .from("kajabi_offer_mappings")
    .select("instructor_slug, mentorship_type")
    .eq("offer_id", offerId)
    .single();

  if (error || !data) {
    console.error("Error fetching offer mapping:", error);
    return null;
  }

  return data;
}

async function verifyOfferInKajabi(offerId: string): Promise<boolean> {
  if (!kajabiApiKey || !kajabiApiSecret) {
    return true;
  }

  try {
    const response = await fetch(`https://api.kajabi.com/v1/offers/${offerId}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${kajabiApiKey}:${kajabiApiSecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
    });

    return response.ok;
  } catch (error) {
    console.error("Error verifying offer in Kajabi:", error);
    return false;
  }
}

async function decrementInventory(
  supabase: any,
  instructorSlug: string,
  type: "one-on-one" | "group",
  quantity: number
) {
  const column = type === "one-on-one" ? "one_on_one_inventory" : "group_inventory";

  for (let i = 0; i < quantity; i++) {
    const { error } = await supabase.rpc("decrement_inventory", {
      slug_param: instructorSlug,
      inventory_column: column,
      decrement_by: 1,
    });

    if (error) {
      console.error("Error decrementing inventory:", error);
      return false;
    }
  }

  return true;
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
    const userAgent = request.headers.get("user-agent") || "";

    if (!userAgent.includes("Kajabi") && !userAgent.includes("kajabi")) {
      console.warn(`Unexpected User-Agent: ${userAgent}`);
    }

    const event: KajabiPayload = JSON.parse(payload);
    
    if (
      event.event !== "purchase.created" &&
      event.event !== "payment.succeeded" &&
      event.event !== "order.created"
    ) {
      return NextResponse.json({ received: true, message: `Event type ${event.event} not processed` });
    }

    const offerId = event.offer?.id;
    if (!offerId) {
      return NextResponse.json({ error: "No offer ID in payload" }, { status: 400 });
    }

    const isValidOffer = await verifyOfferInKajabi(offerId);
    if (!isValidOffer) {
      console.warn(`Offer ${offerId} not found in Kajabi or verification failed`);
    }

    const quantity = event.event === "order.created"
      ? (event.transaction?.quantity || event.payment_transaction?.quantity || 1)
      : event.event === "purchase.created" 
        ? (event.transaction?.quantity || 1)
        : (event.payment_transaction?.quantity || 1);

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const mapping = await getOfferMapping(supabase, offerId);

    if (!mapping) {
      console.warn(`No mapping found for offer ID: ${offerId}`);
      return NextResponse.json({ received: true, message: "Offer mapping not found" });
    }

    const success = await decrementInventory(
      supabase,
      mapping.instructor_slug,
      mapping.mentorship_type as "one-on-one" | "group",
      quantity
    );

    if (success) {
      return NextResponse.json({
        received: true,
        message: `Inventory decremented by ${quantity}`,
        instructor: mapping.instructor_slug,
        type: mapping.mentorship_type,
        quantity,
      });
    } else {
      return NextResponse.json({ error: "Failed to decrement inventory" }, { status: 500 });
    }
  } catch (error) {
    console.error("Error processing webhook:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
