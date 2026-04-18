import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../../../convex/_generated/api";

export function useActiveProducts() {
  return useQuery({
    ...convexQuery(api.products.getActiveProducts, {}),
  });
}

export function useProductById(id: string) {
  return useQuery({
    ...convexQuery(api.products.getProductById, { id: id as any }),
    enabled: !!id,
  });
}

export function useMentorProducts(mentorId: string) {
  return useQuery({
    ...convexQuery(api.products.getMentorProducts, { mentorId: mentorId as any }),
    enabled: !!mentorId,
  });
}

export function useProductByStripePriceId(stripePriceId: string) {
  return useQuery({
    ...convexQuery(api.products.getProductByStripePriceId, { stripePriceId }),
    enabled: !!stripePriceId,
  });
}
