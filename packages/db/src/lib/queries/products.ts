import { eq, and, sql } from "drizzle-orm";
import { db } from "../drizzle";
import { mentorshipProducts, mentors, sessionPacks, payments } from "../../schema";

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
 * @deprecated Use getAllActiveProductsPaginated() instead for better performance
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
 * Get all active products with pagination
 * 
 * @param page - Page number (1-indexed)
 * @param pageSize - Number of items per page (default: 20, max: 100)
 * @returns Paginated products with total count
 */
export async function getAllActiveProductsPaginated(
  page: number = 1,
  pageSize: number = 20
): Promise<{
  items: ProductWithMentor[];
  total: number;
  page: number;
  pageSize: number;
}> {
  // Validate and clamp pageSize
  const validatedPageSize = Math.min(Math.max(1, pageSize), 100);
  const validatedPage = Math.max(1, page);
  const offset = (validatedPage - 1) * validatedPageSize;

  // Get total count
  // Note: innerJoin to mentors removed because mentorshipProducts.mentorId has NOT NULL constraint
  // with onDelete: "cascade" foreign key, so orphaned products cannot exist
  const totalResult = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(mentorshipProducts)
    .where(eq(mentorshipProducts.active, true));

  const total = Number(totalResult[0]?.count || 0);

  // Get paginated items
  const products = await db
    .select({
      product: mentorshipProducts,
      mentor: mentors,
    })
    .from(mentorshipProducts)
    .innerJoin(mentors, eq(mentorshipProducts.mentorId, mentors.id))
    .where(eq(mentorshipProducts.active, true))
    .limit(validatedPageSize)
    .offset(offset);

  return {
    items: products.map((p) => ({ ...p.product, mentor: p.mentor })),
    total,
    page: validatedPage,
    pageSize: validatedPageSize,
  };
}

/**
 * Create a mentorship product
 * 
 * @param mentorId - UUID of the mentor
 * @param title - Product title
 * @param price - Price as string (e.g., "375.00")
 * @param stripePriceId - Stripe Price ID (optional)
 * @param paypalProductId - PayPal Product ID (optional)
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
  paypalProductId?: string,
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
      paypalProductId,
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

/**
 * Get grandfathered price for a user-mentor combination
 * 
 * Checks if the user has previously purchased from this mentor.
 * If yes, returns the product with the original price they paid.
 * This allows the student to repurchase at their original price.
 * 
 * @param userId - Clerk user ID
 * @param mentorId - Mentor/instructor ID
 * @returns Product with original price if found, null if no prior purchase
 */
export async function getGrandfatheredPrice(
  userId: string,
  mentorId: string
): Promise<{ hasPriorPurchase: boolean; originalPrice: string | null }> {
  // Check for existing session pack with this mentor that's paid
  const [existingPack] = await db
    .select()
    .from(sessionPacks)
    .where(
      and(
        eq(sessionPacks.userId, userId),
        eq(sessionPacks.mentorId, mentorId),
        eq(sessionPacks.status, "active")
      )
    )
    .limit(1);

  if (!existingPack) {
    return { hasPriorPurchase: false, originalPrice: null };
  }

  // Get the payment to find amount paid
  const [payment] = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.id, existingPack.paymentId),
        eq(payments.status, "completed")
      )
    )
    .limit(1);

  if (!payment) {
    return { hasPriorPurchase: false, originalPrice: null };
  }

  return {
    hasPriorPurchase: true,
    originalPrice: payment.amount,
  };
}
