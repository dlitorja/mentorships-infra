import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { getAdminOrders } from "@mentorships/db";

const listOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * GET /api/admin/orders
 * List orders for admin dashboard
 * 
 * Query params:
 * - page: Page number (default: 1)
 * - pageSize: Items per page (default: 20, max: 100)
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

    const { page, pageSize } = parsedQuery.data;

    const result = await getAdminOrders(page, pageSize);

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
      page: result.page,
      pageSize: result.pageSize,
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