import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../drizzle";
import { orders } from "../../schema";
import type { OrderStatus, PaymentProvider } from "../../schema/orders";

type Order = typeof orders.$inferSelect;

/**
 * Create a new order
 * 
 * @param userId - Clerk user ID
 * @param provider - Payment provider (stripe | paypal)
 * @param totalAmount - Total amount as string (e.g., "100.00")
 * @param currency - Currency code (default: "usd")
 * @returns Created order
 */
export async function createOrder(
  userId: string,
  provider: PaymentProvider,
  totalAmount: string,
  currency: string = "usd"
): Promise<Order> {
  const [order] = await db
    .insert(orders)
    .values({
      userId,
      provider,
      totalAmount,
      currency,
      status: "pending",
    })
    .returning();

  if (!order) {
    throw new Error("Failed to create order");
  }

  return order;
}

/**
 * Get order by ID
 * 
 * @param orderId - UUID of the order
 * @returns Order or null if not found
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
 * Get orders for a user
 * @deprecated Use getUserOrdersPaginated() instead for better performance
 * 
 * @param userId - Clerk user ID
 * @returns Array of orders
 */
export async function getUserOrders(userId: string): Promise<Order[]> {
  const userOrders = await db
    .select()
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt));

  return userOrders;
}

/**
 * Get orders for a user with pagination
 * 
 * @param userId - Clerk user ID
 * @param page - Page number (1-indexed)
 * @param pageSize - Number of items per page (default: 20, max: 100)
 * @returns Paginated orders with total count
 */
export async function getUserOrdersPaginated(
  userId: string,
  page: number = 1,
  pageSize: number = 20
): Promise<{
  items: Order[];
  total: number;
  page: number;
  pageSize: number;
}> {
  // Validate and clamp pageSize
  const validatedPageSize = Math.min(Math.max(1, pageSize), 100);
  const validatedPage = Math.max(1, page);
  const offset = (validatedPage - 1) * validatedPageSize;

  // Get total count
  const totalResult = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(orders)
    .where(eq(orders.userId, userId));

  const total = Number(totalResult[0]?.count || 0);

  // Get paginated items
  const userOrders = await db
    .select()
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt))
    .limit(validatedPageSize)
    .offset(offset);

  return {
    items: userOrders,
    total,
    page: validatedPage,
    pageSize: validatedPageSize,
  };
}

/**
 * Update order status
 * 
 * @param orderId - UUID of the order
 * @param status - New order status
 * @returns Updated order
 */
export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus
): Promise<Order> {
  const [order] = await db
    .update(orders)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId))
    .returning();

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  return order;
}

/**
 * Cancel/delete order (for cleanup of orphaned orders)
 */
export async function cancelOrder(orderId: string): Promise<Order> {
  return await updateOrderStatus(orderId, "canceled");
}

/**
 * Get pending orders for a user
 * 
 * @param userId - Clerk user ID
 * @returns Array of pending orders
 */
export async function getUserPendingOrders(userId: string): Promise<Order[]> {
  const pendingOrders = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.status, "pending")
      )
    );

  return pendingOrders;
}
