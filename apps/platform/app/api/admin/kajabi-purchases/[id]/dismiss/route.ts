import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { requireAdminOrSupportForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { convexIdSchema } from "@/lib/validators";

const dismissSchema = z.object({
  reason: z.string().max(1000).optional(),
});

/**
 * POST /api/admin/kajabi-purchases/[id]/dismiss
 * Marks a pending confirmation as dismissed (already onboarded, duplicate,
 * not a mentorship purchase, etc.).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    await requireAdminOrSupportForApi();

    const { id } = await params;
    const purchaseId = convexIdSchema.parse(id) as Id<"kajabiPurchaseInbox">;

    const body = await req.json().catch(() => ({}));
    const parsed = dismissSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const convex = await getAuthenticatedConvexClient();
    await convex.mutation(api.kajabiPurchaseInbox.dismissPurchase, {
      id: purchaseId,
      reason: parsed.data.reason,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Failed to dismiss purchase" },
      { status: 500 }
    );
  }
}
