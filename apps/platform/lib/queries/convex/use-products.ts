"use client";

import { useQuery } from "@convex-dev/react-query";

export function useActiveProducts() {
  return useQuery("products:listActive");
}

export function useProduct(id: string) {
  return useQuery("products:getById", { id: id as any });
}

export function useProductByStripePriceId(stripePriceId: string) {
  return useQuery("products:getByStripePriceId", { stripePriceId });
}

export function useProductsByInstructor(instructorId: string) {
  return useQuery("products:listByInstructor", { instructorId: instructorId as any });
}