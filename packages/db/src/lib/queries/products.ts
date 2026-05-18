import { eq, and, sql } from "drizzle-orm";
import { db } from "../drizzle";
import { mentorshipProducts, instructorIntegrations, instructors, sessionPacks, payments } from "../../schema";

type Product = typeof mentorshipProducts.$inferSelect;
type ProductWithInstructor = Product & { instructorIntegration: typeof instructorIntegrations.$inferSelect };

/**
 * Get product by ID with instructor info
 */
export async function getProductById(
  productId: string
): Promise<ProductWithInstructor | null> {
  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(productId)) {
    throw new Error(`Invalid product ID format: ${productId}`);
  }

  const [product] = await db
    .select({
      product: mentorshipProducts,
      instructorIntegration: instructorIntegrations,
    })
    .from(mentorshipProducts)
    .innerJoin(instructors, eq(mentorshipProducts.instructorId, instructors.id))
    .innerJoin(instructorIntegrations, eq(instructors.userId, instructorIntegrations.userId))
    .where(eq(mentorshipProducts.id, productId))
    .limit(1);

  return product ? { ...product.product, instructorIntegration: product.instructorIntegration } : null;
}

/**
 * Get active products by instructor ID
 */
export async function getProductsByInstructorId(
  instructorId: string
): Promise<ProductWithInstructor[]> {
  const products = await db
    .select({
      product: mentorshipProducts,
      instructorIntegration: instructorIntegrations,
    })
    .from(mentorshipProducts)
    .innerJoin(instructors, eq(mentorshipProducts.instructorId, instructors.id))
    .innerJoin(instructorIntegrations, eq(instructors.userId, instructorIntegrations.userId))
    .where(
      and(
        eq(mentorshipProducts.instructorId, instructorId),
        eq(mentorshipProducts.active, true)
      )
    );

  return products.map((p: typeof products[number]) => ({ ...p.product, instructorIntegration: p.instructorIntegration }));
}

export async function getAllActiveProducts(): Promise<ProductWithInstructor[]> {
  const products = await db
    .select({
      product: mentorshipProducts,
      instructorIntegration: instructorIntegrations,
    })
    .from(mentorshipProducts)
    .innerJoin(instructors, eq(mentorshipProducts.instructorId, instructors.id))
    .innerJoin(instructorIntegrations, eq(instructors.userId, instructorIntegrations.userId))
    .where(eq(mentorshipProducts.active, true));

  return products.map((p: typeof products[number]) => ({ ...p.product, instructorIntegration: p.instructorIntegration }));
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
  items: ProductWithInstructor[];
  total: number;
  page: number;
  pageSize: number;
}> {
  // Validate and clamp pageSize
  const validatedPageSize = Math.min(Math.max(1, pageSize), 100);
  const validatedPage = Math.max(1, page);
  const offset = (validatedPage - 1) * validatedPageSize;

  // Get total count
  // Note: innerJoin to instructorIntegrations via instructors ensures we have integration data
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
      instructorIntegration: instructorIntegrations,
    })
    .from(mentorshipProducts)
    .innerJoin(instructors, eq(mentorshipProducts.instructorId, instructors.id))
    .innerJoin(instructorIntegrations, eq(instructors.userId, instructorIntegrations.userId))
    .where(eq(mentorshipProducts.active, true))
    .limit(validatedPageSize)
    .offset(offset);

  return {
    items: products.map((p: typeof products[number]) => ({ ...p.product, instructorIntegration: p.instructorIntegration })),
    total,
    page: validatedPage,
    pageSize: validatedPageSize,
  };
}

/**
 * Create a mentorship product
 * 
 * @param instructorId - UUID of the instructor
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
  instructorId: string,
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
      instructorId,
      title,
      price,
      stripePriceId,
      paypalProductId,
      sessionsPerPack,
      validityDays,
      active,
    } as any)
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
 * Get grandfathered price for a user-instructor combination
 * 
 * Checks if the user has previously purchased from this instructor.
 * If yes, returns the product with the original price they paid.
 * This allows the student to repurchase at their original price.
 * 
 * @param userId - Clerk user ID
 * @param instructorId - Instructor ID
 * @returns Product with original price if found, null if no prior purchase
 */
export async function getGrandfatheredPrice(
  userId: string,
  instructorId: string
): Promise<{ hasPriorPurchase: boolean; originalPrice: string | null }> {
  // Check for existing session pack with this instructor that's paid
  const [existingPack] = await db
    .select()
    .from(sessionPacks)
    .where(
      and(
        eq(sessionPacks.userId, userId),
        eq(sessionPacks.instructorId, instructorId),
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
