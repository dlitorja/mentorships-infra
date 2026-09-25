import { NextRequest, NextResponse } from "next/server";
import { convexServerCall } from "@/lib/convex-server-call";
import { getInstructorInventory } from "@/lib/supabase-inventory";

interface PublicInventoryResponse {
  success: boolean;
  // `null` means "Convex field is unset" (never written). `number`
  // means "Convex field has been explicitly set" — including 0,
  // which is the live value after a Kajabi purchase decremented
  // it. The route uses this null-vs-number distinction to decide
  // whether to fall back to Supabase; the client receives a
  // pure-numbers contract as before.
  one_on_one_inventory: number | null;
  group_inventory: number | null;
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
 * During the Supabase → Convex rollout window, a Convex field may
 * be `null` (unset — never written) even when Supabase has a
 * baseline. We must fall back to Supabase for that field, or the
 * public offer button flashes "Sold out — Join Waitlist" for
 * visitors whose Kajabi checkout is still active.
 *
 * Once a Convex field has been touched (a real number, including
 * a post-Kajabi-purchase `0`), the field is authoritative and we
 * do NOT fall back to Supabase — Supabase is now stale and a
 * positive Supabase value would advertise a sold-out offer as
 * available.
 *
 * Once the Supabase `instructor_inventory` table is dropped in the
 * Phase 3 narrow PR, this helper collapses to "return Convex
 * verbatim, with null coerced to 0" and the Supabase import is
 * removed.
 */
function preferLiveInventory(
  convex: { one_on_one_inventory: number | null; group_inventory: number | null } | null,
  supabase: { one_on_one_inventory: number; group_inventory: number } | null
): InventoryResponse {
  const resolveOne = (): number => {
    if (convex && convex.one_on_one_inventory !== null) {
      return convex.one_on_one_inventory;
    }
    return supabase?.one_on_one_inventory ?? 0;
  };
  const resolveGroup = (): number => {
    if (convex && convex.group_inventory !== null) {
      return convex.group_inventory;
    }
    return supabase?.group_inventory ?? 0;
  };
  return {
    one_on_one_inventory: resolveOne(),
    group_inventory: resolveGroup(),
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

    // Read Convex first; fall back to Supabase for any field
    // that is still unset (null). A Convex field that has been
    // explicitly set — including 0 from a real Kajabi purchase —
    // wins, even if Supabase disagrees, because Supabase has been
    // stale since PR #873.
    let convexInventory: { one_on_one_inventory: number | null; group_inventory: number | null } | null = null;
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

    // Convex has at least one field explicitly set — use the
    // resolver to pick the right value per field.
    const hasAnyConvexValue =
      convexInventory !== null &&
      (convexInventory.one_on_one_inventory !== null ||
        convexInventory.group_inventory !== null);
    if (hasAnyConvexValue) {
      // Only fetch Supabase when at least one Convex field is
      // null (would need a fallback). If both fields are set,
      // skip the Supabase read entirely.
      const needsSupabase =
        convexInventory!.one_on_one_inventory === null ||
        convexInventory!.group_inventory === null;
      const supabaseInventory = needsSupabase
        ? await readSupabaseInventorySafe(slug)
        : null;
      return NextResponse.json(
        preferLiveInventory(convexInventory, supabaseInventory)
      );
    }

    // Convex is null across the board — pre-backfill or unknown
    // slug. Check Supabase to decide.
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
