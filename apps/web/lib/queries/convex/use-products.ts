import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

export function useActiveProducts() {
  return useQuery({
    ...convexQuery(api.products.getActiveProducts, {}),
  });
}

export function useProductById(id: Id<"products">) {
  return useQuery({
    ...convexQuery(api.products.getProductById, { id }),
    enabled: !!id,
  });
}

export function useInstructorProducts(instructorId: Id<"instructors">) {
  return useQuery({
    ...convexQuery(api.products.getInstructorProducts, { mentorId: instructorId }),
    enabled: !!instructorId,
  });
}

export function useProductByStripePriceId(stripePriceId: string) {
  return useQuery({
    ...convexQuery(api.products.getProductByStripePriceId, { stripePriceId }),
    enabled: !!stripePriceId,
  });
}

// Public queries - no auth required

export function usePublicActiveProducts() {
  return useQuery({
    ...convexQuery(api.products.getPublicActiveProducts, {}),
  });
}

export function useProductsByInstructorId(instructorId: Id<"instructors">) {
  return useQuery({
    ...convexQuery(api.products.getProductsByInstructorId, { mentorId: instructorId }),
    enabled: !!instructorId,
  });
}

export function useProductsByInstructorAndType(instructorId: Id<"instructors">, mentorshipType?: string) {
  return useQuery({
    ...convexQuery(api.products.getProductsByInstructorAndType, { mentorId: instructorId, mentorshipType }),
    enabled: !!instructorId,
  });
}

// Alias for backward compatibility
export const useProductsByMentorId = useInstructorProducts;
