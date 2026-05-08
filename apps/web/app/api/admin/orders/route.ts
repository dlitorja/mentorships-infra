import { NextRequest, NextResponse } from "next/server";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { getAdminOrders } from "@mentorships/db";

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

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)), 100);

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
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes("Forbidden")) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error fetching orders:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch orders" },
      { status: 500 }
    );
  }
}