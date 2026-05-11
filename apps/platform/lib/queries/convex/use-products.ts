"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export function useProduct(id: string) {
  return useQuery({
    ...convexQuery(api.products.getProductById, { id: id as Id<"products"> }),
    enabled: !!id,
  });
}

export function useActiveProducts() {
  return useQuery({
    ...convexQuery(api.products.getActiveProducts, {}),
  });
}

export function useAllProducts() {
  return useQuery({
    ...convexQuery(api.products.getActiveProducts, {}),
  });
}

export function useProductByStripePriceId(stripePriceId: string) {
  return useQuery({
    ...convexQuery(api.products.getProductByStripePriceId, { stripePriceId }),
    enabled: !!stripePriceId,
  });
}

export function useProductsByInstructor(instructorId: string) {
  return useQuery({
    ...convexQuery(api.products.getProductsByInstructorId, { mentorId: instructorId as Id<"instructors"> }),
    enabled: !!instructorId,
  });
}

export function useProductsByMentorId(instructorId: string) {
  return useQuery({
    ...convexQuery(api.products.getProductsByInstructorId, { mentorId: instructorId as Id<"instructors"> }),
    enabled: !!instructorId,
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.products.createProduct),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.products.updateProduct),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.products.deleteProduct),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}