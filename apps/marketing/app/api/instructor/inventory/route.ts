import { NextRequest, NextResponse } from "next/server";
import { convexServerCall } from "@/lib/convex-server-call";
import { getInstructorInventory } from "@/lib/supabase-inventory";

interface PublicInventoryResponse {
  success: boolean;
  one_on_one_inventory: number;
  group_inventory: number;
}

interface PublicInventoryErrorResponse {
  success: false;
  error: string;
}

interface InventoryResponse {
  one_on_one_inventory: number;
  group_inventory: number;
}

const ZERO_INVENTORY: InventoryResponse = {
  one_on_one_inventory: 0,
  group_inventory: 0,
};

/**
 * Pick the inventory value to return to the public offer page.
 *
 * During the Supabase → Convex rollout window, Convex may be `null` or
 * `0` for an instructor whose Supabase baseline has not yet been
 * backfilled. Showing zero would flash "Sold out — Join Waitlist"
 * for visitors whose Kajabi checkout is still active, which is the
 * exact regression this PR is meant to fix.
 *
 * The rule is per-field: prefer Convex when it is non-null AND
 * non-zero; otherwise fall back to Supabase. This handles partial
 * rollout states (admin touched one field but not the other) and
 * the post-backfill steady state (both systems agree).
 *
 * Once the Supabase `instructor_inventory` table is dropped in the
 * Phase 3 narrow PR, this helper collapses to "return Convex
 * verbatim" and the Supabase import is removed.
 */
function preferLiveInventory(
  convex: { one_on_one_inventory: number; group_inventory: number } | null,
  supabase: { one_on_one_inventory: number; group_inventory: number } | null
): InventoryResponse {
  const convexOne = convex?.one_on_one_inventory ?? 0;
  const convexGroup = convex?.group_inventory ?? 0;
  const supabaseOne = supabase?.one_on_one_inventory ?? 0;
  const supabaseGroup = supabase?.group_inventory ?? 0;

  return {
    one_on_one_inventory:
      convexOne > 0 ? convexOne : supabaseOne,
    group_inventory:
      convexGroup > 0 ? convexGroup : supabaseGroup,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get("slug");

    if (!slug) {
      return NextResponse.json(
        { error: "Missing slug parameter" },
        { status: 400 }
      );
    }

    // Read Convex first; fall back to Supabase for any field that
    // has not yet been backfilled. Convex is the authoritative
    // store going forward, but we cannot show "Sold out" during
    // the rollout window if the backfill has not caught up.
    let convexInventory: { one_on_one_inventory: number; group_inventory: number } | null = null;
    try {
      const response = await convexServerCall<
        PublicInventoryResponse | PublicInventoryErrorResponse
      >("/inventory/get-public-by-slug", { slug });

      if (response.success) {
        convexInventory = {
          one_on_one_inventory: response.one_on_one_inventory,
          group_inventory: response.group_inventory,
        };
      }
    } catch (error) {
      // Convex unavailable — degrade gracefully by reading
      // Supabase for both fields. This is the same contract as
      // the pre-Phase-2 behavior.
      console.error("Convex inventory read failed; falling back to Supabase:", error);
    }

    // Convex has a real value for at least one field — trust it.
    if (
      convexInventory !== null &&
      (convexInventory.one_on_one_inventory > 0 ||
        convexInventory.group_inventory > 0)
    ) {
      // Still fill in any zero field from Supabase, in case
      // the backfill only partially landed (e.g. admin manually
      // patched one field).
      const supabaseInventory = await readSupabaseInventorySafe(slug);
      return NextResponse.json(
        preferLiveInventory(convexInventory, supabaseInventory)
      );
    }

    // Convex is null/0 across the board — likely pre-backfill or
    // genuinely sold out. Check Supabase to decide.
    const supabaseInventory = await readSupabaseInventorySafe(slug);
    if (supabaseInventory !== null) {
      return NextResponse.json(
        preferLiveInventory(convexInventory, supabaseInventory)
      );
    }

    return NextResponse.json(ZERO_INVENTORY, { status: 200 });
  } catch (error) {
    console.error("Error fetching inventory:", error);
    return NextResponse.json(
      { error: "Failed to fetch inventory" },
      { status: 500 }
    );
  }
}

async function readSupabaseInventorySafe(
  slug: string
): Promise<InventoryResponse | null> {
  try {
    const row = await getInstructorInventory(slug);
    return row;
  } catch (error) {
    console.error(`Supabase inventory read failed for ${slug}:`, error);
    return null;
  }
}
