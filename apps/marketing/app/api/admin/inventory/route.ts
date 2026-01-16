import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const updateInventorySchema = z.object({
  slug: z.string().min(1),
  one_on_one_inventory: z.number().int().nonnegative().optional(),
  group_inventory: z.number().int().nonnegative().optional(),
});

const inventoryRecordSchema = z.object({
  id: z.string(),
  instructor_slug: z.string(),
  one_on_one_inventory: z.number().int().nonnegative(),
  group_inventory: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
  updated_by: z.string().nullable(),
});

const inventoryListSchema = z.array(inventoryRecordSchema);

export async function PATCH(request: Request): Promise<Response> {
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
    const parseResult = updateInventorySchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { slug, one_on_one_inventory, group_inventory } = parseResult.data;

    const { data, error } = await supabaseAdmin
      .from("instructor_inventory")
      .upsert(
        {
          instructor_slug: slug,
          one_on_one_inventory: one_on_one_inventory ?? 0,
          group_inventory: group_inventory ?? 0,
          updated_at: new Date().toISOString(),
          updated_by: "admin",
        },
        { onConflict: "instructor_slug" }
      )
      .select()
      .single();

    if (error) {
      console.error("Error upserting inventory:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    const validatedData = inventoryRecordSchema.parse(data);
    return NextResponse.json(validatedData);
  } catch (error) {
    console.error("Inventory update error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET(): Promise<Response> {
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

    const validatedData = inventoryListSchema.parse(data);
    return NextResponse.json(validatedData);
  } catch (error) {
    console.error("Inventory fetch error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
