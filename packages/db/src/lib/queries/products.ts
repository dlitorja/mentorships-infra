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

