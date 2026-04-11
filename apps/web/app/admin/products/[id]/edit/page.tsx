"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type ProductInfo = {
  id: string;
  mentorId: string;
  mentorName: string;
  title: string;
  description: string | null;
  price: string;
  sessionsPerPack: number;
  validityDays: number;
  stripePriceId: string | null;
  paypalProductId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type ApiResponse = ProductInfo & {
  error?: string;
};

export default function EditProductPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [sessionsPerPack, setSessionsPerPack] = useState(4);
  const [validityDays, setValidityDays] = useState(30);
  const [enableStripe, setEnableStripe] = useState(true);
  const [enablePayPal, setEnablePayPal] = useState(true);

  useEffect(() => {
    async function fetchProduct() {
      try {
        const res = await fetch(`/api/admin/products/${productId}`);
        const data: ApiResponse = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to fetch product");
        }
        setTitle(data.title);
        setDescription(data.description || "");
        setPrice(data.price);
        setSessionsPerPack(data.sessionsPerPack);
        setValidityDays(data.validityDays);
        setEnableStripe(!!data.stripePriceId);
        setEnablePayPal(!!data.paypalProductId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch product");
      } finally {
        setLoading(false);
      }
    }
    if (productId) {
      fetchProduct();
    }
  }, [productId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/admin/products/${productId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          price,
          sessionsPerPack,
          validityDays,
          enableStripe,
          enablePayPal,
          deactivateOldPrice: true,
        }),
      });

      const data: ApiResponse = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update product");
      }

      setSuccess("Product updated successfully!");
      setTimeout(() => {
        router.push("/admin/products");
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update product");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Edit Product</h1>
        <div className="text-center py-8">Loading product...</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/admin/products"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to Products
        </Link>
      </div>

      <h1 className="text-3xl font-bold mb-8">Edit Product</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded mb-4">
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block mb-2 font-medium">Product Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 border rounded"
            required
          />
        </div>

        <div>
          <label className="block mb-2 font-medium">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border rounded"
            rows={3}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block mb-2 font-medium">Price (USD)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full px-3 py-2 border rounded"
              required
            />
          </div>

          <div>
            <label className="block mb-2 font-medium">Sessions per Pack</label>
            <input
              type="number"
              min="1"
              max="100"
              value={sessionsPerPack}
              onChange={(e) => setSessionsPerPack(parseInt(e.target.value))}
              className="w-full px-3 py-2 border rounded"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block mb-2 font-medium">Validity (days)</label>
            <input
              type="number"
              min="1"
              max="365"
              value={validityDays}
              onChange={(e) => setValidityDays(parseInt(e.target.value))}
              className="w-full px-3 py-2 border rounded"
              required
            />
          </div>
        </div>

        <div className="space-y-3">
          <label className="block font-medium">Payment Providers</label>
          
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={enableStripe}
              onChange={(e) => setEnableStripe(e.target.checked)}
            />
            <span>Enable Stripe</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={enablePayPal}
              onChange={(e) => setEnablePayPal(e.target.checked)}
            />
            <span>Enable PayPal</span>
          </label>
        </div>

        <div className="flex gap-4">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
          <Link
            href="/admin/products"
            className="px-4 py-2 border rounded hover:bg-muted"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}