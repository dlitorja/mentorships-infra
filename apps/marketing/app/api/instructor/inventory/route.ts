import { NextRequest, NextResponse } from "next/server";
import { convexServerCall } from "@/lib/convex-server-call";
import type { getInstructorInventory as getInstructorInventoryType } from "@/lib/supabase-inventory";

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
 * Lazy Supabase fallback reader.
 *
 * `apps/marketing/lib/supabase-inventory.ts` throws at module load
 * when `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * are not configured. During the rollout window, an environment
 * may have been provisioned for Convex-only without the legacy
 * Supabase keys, in which case eagerly importing the module would
 * fail the entire route handler — including instructors whose
 * Convex inventory is already complete. Lazy-import on first use
 * isolates that failure to the fallback path.
 *
 * Once the Supabase `instructor_inventory` table is dropped in
 * the Phase 3 narrow PR, this helper is removed along with the
 * module-level Supabase read.
 */
type InventoryReader = typeof getInstructorInventoryType;
let inventoryReaderPromise: Promise<InventoryReader | null> | null = null;
async function loadInventoryReader(): Promise<InventoryReader | null> {
  if (!inventoryReaderPromise) {
    inventoryReaderPromise = (async () => {
      try {
        const mod = await import("@/lib/supabase-inventory");
        return mod.getInstructorInventory;
      } catch (error) {
        // Module-load failure (env vars missing) or import
        // resolution failure — fall through and return null so
        // the route can still serve Convex-only values.
        console.error(
          "Supabase inventory reader unavailable; falling back to Convex-only:",
          error
        );
        return null;
      }
    })();
  }
  return inventoryReaderPromise;
}

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

    // Read Convex first. `{ success: true }` means the instructor
    // is publicly visible and we have inventory data (possibly
    // both fields null = unset, possibly one or both real
    // numbers including 0 from a Kajabi purchase).
    //
    // `{ success: false }` means the instructor is hidden /
    // unlisted / soft-deleted / genuinely not found. In that
    // case we MUST NOT consult Supabase — an unlisted instructor
    // must remain invisible even if a stale Supabase row still
    // holds a positive value. Return zeros.
    let convexInventory: { one_on_one_inventory: number | null; group_inventory: number | null } | null = null;
    let convexRefused = false;
    try {
      const response = await convexServerCall<
        PublicInventoryResponse | PublicInventoryErrorResponse
      >("/inventory/get-public-by-slug", { slug });

      if (response.success) {
        convexInventory = {
          one_on_one_inventory: response.one_on_one_inventory,
          group_inventory: response.group_inventory,
        };
      } else {
        convexRefused = true;
      }
    } catch (error) {
      // Convex unavailable (transport-level error). We do NOT
      // fall back to Supabase here: Supabase may hold a stale
      // positive value for an offer that Kajabi has already
      // sold out of, and advertising a checkout link for a
      // sold-out offer is worse than hiding the buy CTA.
      // Returning zeros (offer page renders no stock message)
      // is the safe default until Convex recovers.
      console.error("Convex inventory read failed; returning zeros:", error);
    }

    if (convexRefused) {
      // Visibility rule: Convex says "not publicly visible".
      // Do not leak a Supabase baseline for an unlisted
      // instructor. Return zeros so the offer page hides the
      // buy CTA entirely (it gates on both fields being > 0).
      return NextResponse.json(ZERO_INVENTORY, { status: 200 });
    }

    if (convexInventory === null) {
      // Convex transport failed. Per the policy above, we
      // return zeros rather than leak stale Supabase
      // availability.
      return NextResponse.json(ZERO_INVENTORY, { status: 200 });
    }

    // Convex has at least one field explicitly set — use the
    // resolver to pick the right value per field. Only fall
    // back to Supabase for fields that Convex reports as
    // `null` (the pre-backfill signal).
    const hasAnyConvexValue =
      convexInventory.one_on_one_inventory !== null ||
      convexInventory.group_inventory !== null;
    if (hasAnyConvexValue) {
      const needsSupabase =
        convexInventory.one_on_one_inventory === null ||
        convexInventory.group_inventory === null;
      const supabaseInventory = needsSupabase
        ? await readSupabaseInventorySafe(slug)
        : null;
      return NextResponse.json(
        preferLiveInventory(convexInventory, supabaseInventory)
      );
    }

    // Convex transport succeeded but both fields are null
    // (pre-backfill) — fall back to Supabase.
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
  const reader = await loadInventoryReader();
  if (!reader) {
    return null;
  }
  try {
    const row = await reader(slug);
    return row;
  } catch (error) {
    console.error(`Supabase inventory read failed for ${slug}:`, error);
    return null;
  }
}
