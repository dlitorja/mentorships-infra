"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";

export function useProduct(id: string) {
  return useQuery({
    ...convexQuery(api.products.getById, { id: id as Id<"products"> }),
    enabled: !!id,
  });
}

export function useActiveProducts() {
  return useQuery({
    ...convexQuery(api.products.listActive, {}),
  });
}

export function useAllProducts() {
  return useQuery({
    ...convexQuery(api.products.listAll, {}),
  });
}

export function useProductByStripePriceId(stripePriceId: string) {
  return useQuery({
    ...convexQuery(api.products.getByStripePriceId, { stripePriceId }),
    enabled: !!stripePriceId,
  });
}

export function useProductsByInstructor(instructorId: string) {
  return useQuery({
    ...convexQuery(api.products.listByInstructor, { instructorId: instructorId as Id<"instructors"> }),
    enabled: !!instructorId,
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.products.create),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.products.update),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.products.remove),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}