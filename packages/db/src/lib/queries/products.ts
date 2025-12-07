import { eq, and } from "drizzle-orm";
import { db } from "../drizzle";
import { mentorshipProducts } from "../../schema";

/**
 * Get mentorship product by ID
 * 
 * @param productId - UUID of the product
 * @returns Product or null if not found
 */
export async function getProductById(productId: string) {
  const [product] = await db
    .select()
    .from(mentorshipProducts)
    .where(eq(mentorshipProducts.id, productId))
    .limit(1);

  return product || null;
}

/**
 * Get active mentorship products for a mentor
 * 
 * @param mentorId - UUID of the mentor
 * @returns Array of active products
 */
export async function getMentorActiveProducts(mentorId: string) {
  const products = await db
    .select()
    .from(mentorshipProducts)
    .where(
      and(
        eq(mentorshipProducts.mentorId, mentorId),
        eq(mentorshipProducts.active, true)
      )
    );

  return products;
}

/**
 * Get all active mentorship products
 * 
 * @returns Array of all active products
 */
export async function getAllActiveProducts() {
  const products = await db
    .select()
    .from(mentorshipProducts)
    .where(eq(mentorshipProducts.active, true));

  return products;
}

/**
 * Create a mentorship product
 * 
 * @param mentorId - UUID of the mentor
 * @param title - Product title
 * @param price - Price as string (e.g., "375.00")
 * @param stripePriceId - Stripe Price ID (optional)
 * @param sessionsPerPack - Number of sessions (default: 4)
 * @param validityDays - Validity period in days (default: 30)
 * @param active - Whether product is active (default: true)
 * @returns Created product
 */
export async function createProduct(
  mentorId: string,
  title: string,
  price: string,
  stripePriceId?: string,
  sessionsPerPack: number = 4,
  validityDays: number = 30,
  active: boolean = true
) {
  const [product] = await db
    .insert(mentorshipProducts)
    .values({
      mentorId,
      title,
      price,
      stripePriceId,
      sessionsPerPack,
      validityDays,
      active,
    })
    .returning();

  return product;
}

/**
 * Validate product is available for purchase
 * 
 * @param productId - UUID of the product
 * @returns Object with validation result
 */
export async function validateProductForPurchase(productId: string): Promise<{
  valid: boolean;
  product: typeof mentorshipProducts.$inferSelect | null;
  reason?: string;
}> {
  const product = await getProductById(productId);

  if (!product) {
    return { valid: false, product: null, reason: "Product not found" };
  }

  if (!product.active) {
    return { valid: false, product, reason: "Product is not active" };
  }

  if (!product.stripePriceId && !product.paypalProductId) {
    return {
      valid: false,
      product,
      reason: "Product has no payment provider configured",
    };
  }

  return { valid: true, product };
}
