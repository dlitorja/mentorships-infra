import { isNull, isNotNull, and, sql, type SQL } from "drizzle-orm";

/**
 * Soft deletion utilities
 * 
 * These helpers make it easy to filter out soft-deleted records in queries.
 * Always use these helpers when querying tables with deleted_at fields.
 * 
 * Note: These functions are generic and work with any table that has a deletedAt field.
 * You need to provide the table reference when using them.
 */

/**
 * Creates a condition to filter out soft-deleted records (where deleted_at IS NULL)
 * 
 * @param tableColumn - The deletedAt column reference from your table
 * 
 * @example
 * ```typescript
 * import { orders } from "@mentorships/db";
 * 
 * const activeOrders = await db
 *   .select()
 *   .from(orders)
 *   .where(and(eq(orders.userId, userId), notDeleted(orders.deletedAt)));
 * ```
 */
export function notDeleted(tableColumn: any): SQL {
  return isNull(tableColumn);
}

/**
 * Creates a condition to include only soft-deleted records (where deleted_at IS NOT NULL)
 * Use for admin/audit queries.
 * 
 * @param tableColumn - The deletedAt column reference from your table
 * 
 * @example
 * ```typescript
 * import { orders } from "@mentorships/db";
 * 
 * const deletedOrders = await db
 *   .select()
 *   .from(orders)
 *   .where(and(eq(orders.userId, userId), isDeleted(orders.deletedAt)));
 * ```
 */
export function isDeleted(tableColumn: any): SQL {
  return isNotNull(tableColumn);
}
