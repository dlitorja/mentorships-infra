import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";

const listOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  // Previously absent: Zod silently stripped `status`, so the UI's filter was
  // a no-op that returned the unfiltered list paginated as if filtered.
  status: z
    .enum(["pending", "paid", "refunded", "failed", "canceled"])
    .optional(),
  search: z.string().trim().max(200).optional(),
});

/**
 * GET /api/admin/orders
 * List orders for admin dashboard
 *
 * Query params:
 * - page: Page number (default: 1)
 * - pageSize: Items per page (default: 20, max: 100)
 * - status: Filter by order status (applied before pagination)
 * - search: Customer email substring or order id (applied before pagination)
 *
 * Uses Convex as source of truth. Orders are written to Convex during checkout.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRoleForApi("admin");

    const parsedQuery = listOrdersQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams)
    );

    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: "Invalid query", details: parsedQuery.error.issues },
        { status: 400 }
      );
    }

    const { page, pageSize, status, search } = parsedQuery.data;
    const offset = (page - 1) * pageSize;

    const convex = await getAuthenticatedConvexClient();
    const result = await convex.query(api.orders.getOrdersForAdmin, {
      limit: pageSize,
      offset,
      status,
      search,
    });

    return NextResponse.json({
      items: result.items.map((order) => ({
        id: order.id,
        userId: order.userId,
        userEmail: order.userEmail,
        status: order.status,
        provider: order.provider,
        totalAmount: order.totalAmount,
        currency: order.currency,
        createdAt: new Date(order.createdAt).toISOString(),
        payments: order.payments.map((p) => ({
          id: p.id,
          provider: p.provider,
          providerPaymentId: p.providerPaymentId,
          amount: p.amount,
          currency: p.currency,
          status: p.status,
          refundedAmount: p.refundedAmount,
        })),
      })),
      total: result.total,
      page,
      pageSize,
      hasMore: result.hasMore,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error fetching orders:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch orders" },
      { status: 500 }
    );
  }
}
