import { NextRequest, NextResponse } from "next/server";
import { convexServerCall, ConvexServerCallError } from "@/lib/convex-server-call";

interface PublicInventoryResponse {
  success: boolean;
  one_on_one_inventory: number | null;
  group_inventory: number | null;
}

interface PublicInventoryErrorResponse {
  success: false;
  error: string;
}

const ZERO_INVENTORY = {
  one_on_one_inventory: 0,
  group_inventory: 0,
};

/**
 * Inventory source tag, surfaced as the `X-Inventory-Source`
 * response header so operators investigating "sold out"
 * complaints can distinguish:
 *
 *   - "convex":   Convex returned explicit values (or both null
 *                 coerced to 0)
 *   - "convex-not-found": Convex says instructor is not publicly
 *                 visible (404 from HTTP action OR
 *                 `{ success: false }`)
 *   - "convex-error": Convex transport failed (config or network)
 *
 * After HUC-46 Phase 3, the Supabase fallback is gone — every
 * response is one of these three. The page treats all of them as
 * "zeros means sold out" so the visitor never sees a checkout
 * link for an unsold-out offer during an outage. The header is
 * the operator-facing signal that "zeros" may not mean a real
 * sold-out state.
 */
type InventorySource =
  | "convex"
  | "convex-not-found"
  | "convex-error";

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

    let response: PublicInventoryResponse | PublicInventoryErrorResponse;
    try {
      response = await convexServerCall<
        PublicInventoryResponse | PublicInventoryErrorResponse
      >("/inventory/get-public-by-slug", { slug });
    } catch (error) {
      // `convexServerCall` throws on any non-2xx status, including
      // the 404 the HTTP action returns when the instructor is not
      // publicly visible. Treat a 404 as a not-found visibility
      // result (not an outage): the instructor is hidden /
      // unlisted / soft-deleted / genuinely missing.
      if (
        error instanceof ConvexServerCallError &&
        error.status === 404
      ) {
        return NextResponse.json(ZERO_INVENTORY, {
          status: 200,
          headers: {
            "X-Inventory-Source": "convex-not-found" as InventorySource,
          },
        });
      }

      // Convex unavailable (transport-level error). A missing
      // CONVEX_HTTP_KEY or wrong CONVEX_URL would cause EVERY read
      // to throw here. Returning zeros (offer page renders no
      // stock message) is the safe default until Convex recovers.
      console.error("Convex inventory read failed; returning zeros:", error);
      return NextResponse.json(ZERO_INVENTORY, {
        status: 200,
        headers: { "X-Inventory-Source": "convex-error" as InventorySource },
      });
    }

    if (!response.success) {
      // Visibility rule: Convex says "not publicly visible".
      // Return zeros so the offer page hides the buy CTA entirely
      // (it gates on both fields being > 0).
      return NextResponse.json(ZERO_INVENTORY, {
        status: 200,
        headers: { "X-Inventory-Source": "convex-not-found" as InventorySource },
      });
    }

    // Convex is the sole source of truth. `null` means "field is
    // unset" (never written) — coerce to 0 so the offer page
    // renders a deterministic zeros value.
    return NextResponse.json(
      {
        one_on_one_inventory: response.one_on_one_inventory ?? 0,
        group_inventory: response.group_inventory ?? 0,
      },
      { headers: { "X-Inventory-Source": "convex" as InventorySource } }
    );
  } catch (error) {
    console.error("Error fetching inventory:", error);
    return NextResponse.json(
      { error: "Failed to fetch inventory" },
      { status: 500 }
    );
  }
}
