import { eq, desc } from "drizzle-orm";
import { db } from "../drizzle";
import { orders } from "../../schema";

type OrderStatus = "pending" | "paid" | "refunded" | "failed" | "canceled";
type Order = typeof orders.$inferSelect;

/**
 * Get order by ID
 */
export async function getOrderById(orderId: string): Promise<Order | null> {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  return order || null;
}

/**
 * Update order status
 */
export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus
): Promise<Order> {
  const [updated] = await db
    .update(orders)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId))
    .returning();

  return updated;
}

/**
 * Cancel/delete order (for cleanup of orphaned orders)
 */
export async function cancelOrder(orderId: string): Promise<Order> {
  const [updated] = await db
    .update(orders)
    .set({
      status: "canceled",
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId))
    .returning();

  return updated;
}

