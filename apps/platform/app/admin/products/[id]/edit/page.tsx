"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { z } from "zod";
import { type MentorshipType } from "@/lib/queries/api-client";
import { ProductForm } from "../../_components/product-form";

const instructorSchema = z.object({
  instructorId: z.string(),
  email: z.string().nullable(),
  displayName: z.string(),
});

const instructorsResponseSchema = z.object({
  instructors: z.array(instructorSchema),
});

type Instructor = {
  id: string;
  email: string | null;
  name: string;
};

type ProductInfo = {
  id: string;
  instructorId: string;
  instructorName: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  price: string;
  currency: string;
  sessionsPerPack: number;
  validityDays: number;
  mentorshipType: string;
  stripePriceId: string | null;
  stripeProductId: string | null;
  paypalProductId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export default function EditProductPage() {
  const params = useParams();
  const productId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [isLoadingInstructors, setIsLoadingInstructors] = useState(true);
  const [productData, setProductData] = useState<ProductInfo | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [productRes, instructorsRes] = await Promise.all([
          fetch(`/api/admin/products/${productId}`),
          fetch("/api/admin/instructors"),
        ]);

        if (!productRes.ok) {
          const errorData = await productRes.json();
          throw new Error(errorData.error || "Failed to fetch product");
        }

        const product = await productRes.json();
        setProductData(product);

        if (instructorsRes.ok) {
          const instructorsData = await instructorsRes.json();
          const validated = instructorsResponseSchema.parse(instructorsData);
          setInstructors(
            validated.instructors.map((inst) => ({
              id: inst.instructorId,
              email: inst.email || null,
              name: inst.displayName,
            }))
          );
          setIsLoadingInstructors(false);
        } else {
          setIsLoadingInstructors(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch product");
        setIsLoadingInstructors(false);
      } finally {
        setLoading(false);
      }
    }

    if (productId) {
      fetchData();
    }
  }, [productId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Edit Product</h1>
          <div className="text-center py-8">Loading product...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Edit Product</h1>
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!productData) {
    return (
      <div className="min-h-screen bg-background px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Edit Product</h1>
          <div className="text-center py-8">Product not found</div>
        </div>
      </div>
    );
  }

  return (
    <ProductForm
      mode="edit"
      productId={productId}
      initialData={{
        instructorId: productData.instructorId,
        title: productData.title,
        description: productData.description || "",
        imageUrl: productData.imageUrl || "",
        price: productData.price,
        currency: productData.currency,
        sessionsPerPack: productData.sessionsPerPack,
        validityDays: productData.validityDays,
        mentorshipType: productData.mentorshipType as MentorshipType,
        enableStripe: !!productData.stripePriceId,
        enablePayPal: !!productData.paypalProductId,
      }}
      instructors={instructors}
      isLoadingInstructors={isLoadingInstructors}
    />
  );
}
