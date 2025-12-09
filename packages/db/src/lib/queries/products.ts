import { eq, and } from "drizzle-orm";
import { db } from "../drizzle";
import { mentorshipProducts, mentors } from "../../schema";

type Product = typeof mentorshipProducts.$inferSelect;
type ProductWithMentor = Product & { mentor: typeof mentors.$inferSelect };

/**
 * Get product by ID with mentor info
 */
export async function getProductById(
  productId: string
): Promise<ProductWithMentor | null> {
  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(productId)) {
    throw new Error(`Invalid product ID format: ${productId}`);
  }

  const [product] = await db
    .select({
      product: mentorshipProducts,
      mentor: mentors,
    })
    .from(mentorshipProducts)
    .innerJoin(mentors, eq(mentorshipProducts.mentorId, mentors.id))
    .where(eq(mentorshipProducts.id, productId))
    .limit(1);

  return product ? { ...product.product, mentor: product.mentor } : null;
}

/**
 * Get active products by mentor ID
 */
export async function getProductsByMentorId(
  mentorId: string
): Promise<ProductWithMentor[]> {
  const products = await db
    .select({
      product: mentorshipProducts,
      mentor: mentors,
    })
    .from(mentorshipProducts)
    .innerJoin(mentors, eq(mentorshipProducts.mentorId, mentors.id))
    .where(
      and(
        eq(mentorshipProducts.mentorId, mentorId),
        eq(mentorshipProducts.active, true)
      )
    );

  return products.map((p) => ({ ...p.product, mentor: p.mentor }));
}

/**
 * Get all active products
 */
export async function getAllActiveProducts(): Promise<ProductWithMentor[]> {
  const products = await db
    .select({
      product: mentorshipProducts,
      mentor: mentors,
    })
    .from(mentorshipProducts)
    .innerJoin(mentors, eq(mentorshipProducts.mentorId, mentors.id))
    .where(eq(mentorshipProducts.active, true));

  return products.map((p) => ({ ...p.product, mentor: p.mentor }));
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
): Promise<Product> {
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

  if (!product) {
    throw new Error("Failed to create product");
  }

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
  product: Product | null;
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
