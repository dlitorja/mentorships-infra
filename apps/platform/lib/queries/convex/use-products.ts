"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

/**
 * Fetches a single product by ID.
 * @param {string} id - The product ID
 * @returns {UseQueryResult} Query result containing the product
 */
export function useProduct(id: string) {
  return useQuery({
    ...convexQuery(api.products.getProductById, { id: id as Id<"products"> }),
    enabled: !!id,
  });
}

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
 * Fetches all active products (alias for useActiveProducts).
 * @returns {UseQueryResult} Query result containing active products
 */
export function useAllProducts() {
  return useQuery({
    ...convexQuery(api.products.getActiveProducts, {}),
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

/**
 * Fetches all products for a specific instructor.
 * @param {string} instructorId - The instructor's ID
 * @returns {UseQueryResult} Query result containing the instructor's products
 */
export function useProductsByInstructor(instructorId: string) {
  return useQuery({
    ...convexQuery(api.products.getProductsByInstructorId, { instructorId: instructorId as Id<"instructors"> }),
    enabled: !!instructorId,
  });
}

/**
 * Fetches all products for a specific instructor by their ID.
 * @param {string} instructorId - The instructor's ID
 * @returns {UseQueryResult} Query result containing the instructor's products
 */
export function useProductsByInstructorId(instructorId: string) {
  return useQuery({
    ...convexQuery(api.products.getProductsByInstructorId, { instructorId: instructorId as Id<"instructors"> }),
    enabled: !!instructorId,
  });
}

// Public queries - no auth required

/**
 * Fetches all public active products (no auth required).
 * @returns {UseQueryResult} Query result containing public active products
 */
export function usePublicActiveProducts() {
  return useQuery({
    ...convexQuery(api.products.getPublicActiveProducts, {}),
  });
}

/**
 * Fetches products for a specific instructor filtered by mentorship type.
 * @param {string} instructorId - The instructor's ID
 * @param {string | undefined} mentorshipType - Optional mentorship type filter ("oneOnOne" | "group")
 * @returns {UseQueryResult} Query result containing filtered products
 */
export function useProductsByInstructorAndType(
  instructorId: string,
  mentorshipType?: string
) {
  return useQuery({
    ...convexQuery(api.products.getProductsByInstructorAndType, {
      instructorId: instructorId as Id<"instructors">,
      mentorshipType,
    }),
    enabled: !!instructorId,
  });
}

/**
 * Mutation hook for creating a new product.
 * Invalidates product queries on success.
 */
export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.products.createProduct),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

/**
 * Mutation hook for updating a product.
 * Invalidates product queries on success.
 */
export function useUpdateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.products.updateProduct),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

/**
 * Mutation hook for deleting a product.
 * Invalidates product queries on success.
 */
export function useDeleteProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.products.deleteProduct),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}
