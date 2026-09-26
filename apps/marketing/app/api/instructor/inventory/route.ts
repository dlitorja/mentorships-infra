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
 *   - "convex":        Convex returned explicit numeric values
 *                      for both fields
 *   - "convex-unset":  Convex returned at least one null field
 *                      (field was never written). The route
 *                      coerces null to 0 so the offer page still
 *                      renders deterministically, but the source
 *                      label distinguishes this from a real
 *                      sold-out zero so operators can spot
 *                      instructors that need a backfill pass.
 *   - "convex-not-found": Convex says instructor is not publicly
 *                      visible (404 from HTTP action OR
 *                      `{ success: false }`)
 *   - "convex-error":  Convex transport failed (config or network)
 *
 * After HUC-46 Phase 3, the Supabase fallback is gone — every
 * response is one of these four. The page treats all of them as
 * "zeros means sold out" so the visitor never sees a checkout
 * link for an unsold-out offer during an outage. The header is
 * the operator-facing signal that "zeros" may not mean a real
 * sold-out state. Greptile P1 (PR #883 round 19): distinguishing
 * `convex-unset` from `convex` is required so the source
 * histogram can flag instructors whose Convex fields were never
 * written — otherwise a null that gets coerced to 0 is
 * indistinguishable from a real sold-out.
 */
type InventorySource =
  | "convex"
  | "convex-unset"
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
    // renders a deterministic zeros value. If at least one field
    // was null, surface `convex-unset` as the source so the
    // operator histogram can flag instructors whose Convex
    // fields were never written (a backfill pass on prod is the
    // remediation — see the PR description's `ZERO_FILL_NULLS=1`
    // prerequisite). Greptile P1 (PR #883 round 19): a `convex`
    // label was previously used for both "explicit zero" and
    // "null-coerced-to-zero", which made the two states
    // indistinguishable in the source histogram. Splitting
    // `convex-unset` out closes that gap and lets the marketing
    // offer page detect a stuck offer (both null + has a public
    // page) without inspecting Convex directly.
    const oneOnOneInventory = response.one_on_one_inventory ?? 0;
    const groupInventory = response.group_inventory ?? 0;
    const source: InventorySource =
      response.one_on_one_inventory === null ||
      response.group_inventory === null
        ? "convex-unset"
        : "convex";
    return NextResponse.json(
      {
        one_on_one_inventory: oneOnOneInventory,
        group_inventory: groupInventory,
      },
      { headers: { "X-Inventory-Source": source } }
    );
  } catch (error) {
    console.error("Error fetching inventory:", error);
    return NextResponse.json(
      { error: "Failed to fetch inventory" },
      { status: 500 }
    );
  }
}
