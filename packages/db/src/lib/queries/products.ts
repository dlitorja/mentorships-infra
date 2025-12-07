import { eq } from "drizzle-orm";
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

