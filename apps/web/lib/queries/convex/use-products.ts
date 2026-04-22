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

export function useInstructorProducts(mentorId: Id<"instructors">) {
  return useQuery({
    ...convexQuery(api.products.getMentorProducts, { mentorId }),
    enabled: !!mentorId,
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

export function useProductsByMentorId(mentorId: Id<"mentors">) {
  return useQuery({
    ...convexQuery(api.products.getProductsByMentorId, { mentorId }),
    enabled: !!mentorId,
  });
}

export function useProductsByMentorAndType(mentorId: Id<"mentors">, mentorshipType?: string) {
  return useQuery({
    ...convexQuery(api.products.getProductsByMentorAndType, { mentorId, mentorshipType }),
    enabled: !!mentorId,
  });
}
