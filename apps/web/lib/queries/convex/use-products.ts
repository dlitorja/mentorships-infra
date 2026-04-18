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

export function useMentorProducts(mentorId: Id<"mentors">) {
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
