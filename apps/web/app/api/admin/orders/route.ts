import { NextRequest, NextResponse } from "next/server";
import { db, orders, payments, users, eq, desc, sql, or } from "@mentorships/db";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@mentorships/db";

/**
 * GET /api/admin/orders
 * List orders for admin dashboard
 * 
 * Query params:
 * - page: Page number (default: 1)
 * - pageSize: Items per page (default: 20, max: 100)
 * - status: Filter by order status
 */
export async function GET(req: NextRequest) {
  try {
    await requireRoleForApi("admin");

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = Math.min(parseInt(searchParams.get("pageSize") || "20", 10), 100);
    const status = searchParams.get("status") || undefined;

    const validatedPageSize = Math.min(Math.max(1, pageSize), 100);
    const validatedPage = Math.max(1, page);
    const offset = (validatedPage - 1) * validatedPageSize;

    // Get total count
    const countWhere = status ? eq(orders.status, status as any) : undefined;
    const totalResult = await db
      .select({
        count: sql<number>`count(*)`,
      })
      .from(orders)
      .where(countWhere);

    const total = Number(totalResult[0]?.count || 0);

    // Get orders with payment and user info
    const allOrders = await db
      .select({
        order: orders,
        user: users,
      })
      .from(orders)
      .leftJoin(users, eq(orders.userId, users.id))
      .where(countWhere)
      .orderBy(desc(orders.createdAt))
      .limit(validatedPageSize)
      .offset(offset);

    // Get payment info for each order
    const ordersWithPayments = await Promise.all(
      allOrders.map(async ({ order, user }) => {
        const orderPayments = await db
          .select()
          .from(payments)
          .where(eq(payments.orderId, order.id));

        return {
          id: order.id,
          userId: order.userId,
          userEmail: user?.email || null,
          userFirstName: user?.firstName || null,
          status: order.status,
          provider: order.provider,
          totalAmount: order.totalAmount,
          currency: order.currency,
          createdAt: order.createdAt.toISOString(),
          payments: orderPayments.map((p) => ({
            id: p.id,
            provider: p.provider,
            providerPaymentId: p.providerPaymentId,
            amount: p.amount,
            currency: p.currency,
            status: p.status,
            refundedAmount: p.refundedAmount,
          })),
        };
      })
    );

    return NextResponse.json({
      items: ordersWithPayments,
      total,
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