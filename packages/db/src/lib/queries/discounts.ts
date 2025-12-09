import { eq, and, lte } from "drizzle-orm";
import { db } from "../drizzle";
import { orders } from "../../schema";

/**
 * Configuration for grandfathered pricing
 * 
 * You can customize this based on your business logic:
 * - Check if user has orders before a certain date
 * - Use a specific coupon ID for grandfathered users
 * - Check user metadata or custom fields
 */
export interface GrandfatheredUserConfig {
  /** Stripe coupon ID to apply for grandfathered users */
  couponId?: string;
  /** Stripe promotion code to apply (alternative to couponId) */
  promotionCode?: string;
  /** Date threshold - users with orders before this date are grandfathered */
  grandfatheredBeforeDate?: Date;
}

/**
 * Check if a user is eligible for grandfathered pricing
 * 
 * This checks if the user has any paid orders before the grandfathered date.
 * Users with paid orders before the cutoff date are considered grandfathered.
 * You can customize this logic based on your needs.
 */
export async function isUserGrandfathered(
  userId: string,
  config?: GrandfatheredUserConfig
): Promise<boolean> {
  if (!config?.grandfatheredBeforeDate) {
    return false;
  }

  // Check if user has any paid orders created before the grandfathered date
  const [order] = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.status, "paid"),
        lte(orders.createdAt, config.grandfatheredBeforeDate)
      )
    )
    .limit(1);

  return !!order;
}

/**
 * Get the coupon or promotion code for a grandfathered user
 * 
 * Returns the coupon ID or promotion code to apply, or null if not grandfathered
 */
export async function getGrandfatheredDiscount(
  userId: string,
  config?: GrandfatheredUserConfig
): Promise<{ couponId?: string; promotionCode?: string } | null> {
  const isGrandfathered = await isUserGrandfathered(userId, config);

  if (!isGrandfathered) {
    return null;
  }

  return {
    couponId: config?.couponId,
    promotionCode: config?.promotionCode,
  };
}

/**
 * Get grandfathered pricing config from environment variables
 * 
 * Set these in your .env:
 * - GRANDFATHERED_COUPON_ID: Stripe coupon ID for grandfathered users
 * - GRANDFATHERED_PROMOTION_CODE: Alternative promotion code
 * - GRANDFATHERED_BEFORE_DATE: ISO date string (e.g., "2024-01-01")
 */
export function getGrandfatheredConfig(): GrandfatheredUserConfig {
  return {
    couponId: process.env.GRANDFATHERED_COUPON_ID,
    promotionCode: process.env.GRANDFATHERED_PROMOTION_CODE,
    grandfatheredBeforeDate: process.env.GRANDFATHERED_BEFORE_DATE
      ? new Date(process.env.GRANDFATHERED_BEFORE_DATE)
      : undefined,
  };
}

