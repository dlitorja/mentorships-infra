"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchMentors, type MentorshipType } from "@/lib/queries/api-client";
import { ProductForm } from "../../_components/product-form";

type Mentor = {
  id: string;
  email: string | null;
};

type ProductInfo = {
  id: string;
  mentorId: string;
  mentorName: string;
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
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [productData, setProductData] = useState<ProductInfo | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [productRes, mentorsData] = await Promise.all([
          fetch(`/api/admin/products/${productId}`),
          fetchMentors(),
        ]);

        if (!productRes.ok) {
          const errorData = await productRes.json();
          throw new Error(errorData.error || "Failed to fetch product");
        }

        const product = await productRes.json();
        setProductData(product);
        setMentors(mentorsData.items || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch product");
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
        mentorId: productData.mentorId,
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
      mentors={mentors}
      isLoadingMentors={false}
    />
  );
}
