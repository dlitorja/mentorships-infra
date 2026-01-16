import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function PATCH(request: Request) {
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Supabase configuration missing" },
      { status: 500 }
    );
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
  try {
    await requireAdmin();

    const body = await request.json();
    const { slug, one_on_one_inventory, group_inventory } = body;

    if (!slug) {
      return NextResponse.json(
        { error: "Missing instructor slug" },
        { status: 400 }
      );
    }

    // Check if record exists, if not create it
    const { data: existing } = await supabaseAdmin
      .from("instructor_inventory")
      .select("*")
      .eq("instructor_slug", slug)
      .single();

    let result;

    if (existing) {
      // Update existing record
      const { data, error } = await supabaseAdmin
        .from("instructor_inventory")
        .update({
          one_on_one_inventory,
          group_inventory,
          updated_at: new Date().toISOString(),
        })
        .eq("instructor_slug", slug)
        .select()
        .single();

      if (error) {
        console.error("Error updating inventory:", error);
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        );
      }

      result = data;
    } else {
      // Create new record
      const { data, error } = await supabaseAdmin
        .from("instructor_inventory")
        .insert({
          instructor_slug: slug,
          one_on_one_inventory: one_on_one_inventory ?? 0,
          group_inventory: group_inventory ?? 0,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        console.error("Error creating inventory:", error);
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        );
      }

      result = data;
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Inventory update error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Supabase configuration missing" },
      { status: 500 }
    );
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  try {
    await requireAdmin();

    const { data, error } = await supabaseAdmin
      .from("instructor_inventory")
      .select("*")
      .order("instructor_slug");

    if (error) {
      console.error("Error fetching inventory:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Inventory fetch error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
