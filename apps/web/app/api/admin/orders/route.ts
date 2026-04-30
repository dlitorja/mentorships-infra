import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";

/**
 * GET /api/admin/orders
 * List orders for admin dashboard
 * 
 * Query params:
 * - page: Page number (default: 1)
 * - pageSize: Items per page (default: 20, max: 100)
 * - status: Filter by order status (not yet supported in Convex)
 */
export async function GET(req: NextRequest) {
  try {
    await requireRoleForApi("admin");

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = Math.min(parseInt(searchParams.get("pageSize") || "20", 10), 100);

    const validatedPageSize = Math.min(Math.max(1, pageSize), 100);
    const validatedPage = Math.max(1, page);
    const offset = (validatedPage - 1) * validatedPageSize;

    const convex = getConvexClient();
    const result = await convex.query(api.orders.getOrdersForAdmin, {
      limit: validatedPageSize,
      offset,
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
      page: validatedPage,
      pageSize: validatedPageSize,
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