'use client';

import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { createProduct, createProductFromStripe, updateProduct } from "@/lib/queries/api-client";
import type { ProductData, ProductUpdateResult } from "../types";

export function useProductMutations({
  productId,
  setResult,
}: {
  productId?: string;
  setResult: (result: ProductUpdateResult | null) => void;
}) {
  const router = useRouter();

  const createProductMutation = useMutation({
    mutationFn: async (data: ProductData) => createProduct(data),
    onSuccess: () => {
      // After successful creation, return to products list
      router.push("/admin/products");
    },
    onError: (error) => {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to create product",
      });
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: async (data: ProductData) => {
      if (!productId) throw new Error("Product ID required");
      return updateProduct(productId, data);
    },
    onSuccess: (data) => {
      setResult({
        success: true,
        message: data.message || "Product updated successfully",
        product: {
          id: data.product.id,
          title: data.product.title,
          price: data.product.price,
          currency: data.product.currency,
          sessionsPerPack: data.product.sessionsPerPack,
          validityDays: data.product.validityDays,
          mentorshipType: data.product.mentorshipType,
          stripe: data.product.stripeProductId
            ? {
                productId: data.product.stripeProductId,
                productLink: "",
                priceId: data.product.stripePriceId || "",
                priceLink: "",
              }
            : null,
          paypal: data.product.paypalProductId
            ? {
                productId: data.product.paypalProductId,
                productLink: "",
              }
            : null,
        },
        changes: data.changes,
      });
    },
    onError: (error) => {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to update product",
      });
    },
  });

  const importFromStripeMutation = useMutation({
    mutationFn: async (data: { productId?: string; priceId?: string; instructorId?: string }) => {
      await createProductFromStripe({
        productId: data.productId,
        priceId: data.priceId,
        instructorId: data.instructorId,
      });
    },
    onSuccess: () => {
      setResult({
        success: true,
        message: "Product imported from Stripe successfully",
      });
    },
    onError: (error) => {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to import product",
      });
    },
  });

  const handleCreateSubmit = (values: ProductData) => {
    setResult(null);
    createProductMutation.mutate(values);
  };

  const handleUpdateSubmit = (values: ProductData) => {
    setResult(null);
    updateProductMutation.mutate(values);
  };

  const handleImportSubmit = (values: { productId?: string; priceId?: string; instructorId?: string }) => {
    setResult(null);
    importFromStripeMutation.mutate(values);
  };

  return {
    createProductMutation,
    updateProductMutation,
    importFromStripeMutation,
    handleCreateSubmit,
    handleUpdateSubmit,
    handleImportSubmit,
  };
}
