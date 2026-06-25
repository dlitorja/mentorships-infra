import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

/**
 * Fetches all active products.
 * @returns {UseQueryResult} Query result containing active products
 */
export function useActiveProducts() {
  return useQuery({
    ...convexQuery(api.products.getActiveProducts, {}),
  });
}

/**
 * Fetches a single product by ID.
 * @param {Id<"products">} id - The product ID
 * @returns {UseQueryResult} Query result containing the product
 */
export function useProductById(id: Id<"products">) {
  return useQuery({
    ...convexQuery(api.products.getProductById, { id }),
    enabled: !!id,
  });
}

/**
 * Fetches all products for a specific instructor.
 * @param {Id<"instructors">} instructorId - The instructor's ID
 * @returns {UseQueryResult} Query result containing the instructor's products
 */
export function useInstructorProducts(instructorId: Id<"instructors">) {
  return useQuery({
    ...convexQuery(api.products.getInstructorProducts, { instructorId }),
    enabled: !!instructorId,
  });
}

/**
 * Fetches a product by its Stripe price ID.
 * @param {string} stripePriceId - The Stripe price ID
 * @returns {UseQueryResult} Query result containing the product
 */
export function useProductByStripePriceId(stripePriceId: string) {
  return useQuery({
    ...convexQuery(api.products.getProductByStripePriceId, { stripePriceId }),
    enabled: !!stripePriceId,
  });
}

// Public queries - no auth required

/**
 * Fetches all publicly active products.
 * @returns {UseQueryResult} Query result containing public active products
 */
export function usePublicActiveProducts() {
  return useQuery({
    ...convexQuery(api.products.getPublicActiveProducts, {}),
  });
}

/**
 * Fetches all products for a specific instructor by instructor ID.
 * @param {Id<"instructors">} instructorId - The instructor's ID
 * @returns {UseQueryResult} Query result containing the instructor's products
 */
export function useProductsByInstructorId(instructorId: Id<"instructors">) {
  return useQuery({
    ...convexQuery(api.products.getProductsByInstructorId, { instructorId }),
    enabled: !!instructorId,
  });
}

/**
 * Fetches products for a specific instructor filtered by mentorship type.
 * @param {Id<"instructors">} instructorId - The instructor's ID
 * @param {string} [mentorshipType] - Optional mentorship type filter
 * @returns {UseQueryResult} Query result containing filtered products
 */
export function useProductsByInstructorAndType(instructorId: Id<"instructors">, mentorshipType?: string) {
  return useQuery({
    ...convexQuery(api.products.getProductsByInstructorAndType, { instructorId, mentorshipType }),
    enabled: !!instructorId,
  });
}

// Alias for backward compatibility (old name -> new function)
export const useProductsByInstructorIdAlias = useInstructorProducts;