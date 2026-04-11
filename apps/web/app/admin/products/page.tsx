"use client";

import { useState, useEffect } from "react";
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
};

type ProductsResponse = {
  items: ProductInfo[];
};

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProducts() {
      try {
        const res = await fetch("/api/admin/products");
        const data: ProductsResponse = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to fetch products");
        }
        setProducts(data.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch products");
      } finally {
        setLoading(false);
      }
    }
    fetchProducts();
  }, []);

  const getStatusBadge = (active: boolean) => {
    return active ? (
      <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
        Active
      </span>
    ) : (
      <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
        Inactive
      </span>
    );
  };

  const getProviderBadges = (stripePriceId: string | null, paypalProductId: string | null) => {
    const badges = [];
    if (stripePriceId) {
      badges.push(
        <span key="stripe" className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
          Stripe
        </span>
      );
    }
    if (paypalProductId) {
      badges.push(
        <span key="paypal" className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
          PayPal
        </span>
      );
    }
    return badges.length > 0 ? (
      <div className="flex gap-1">{badges}</div>
    ) : (
      <span className="text-muted-foreground text-sm">None</span>
    );
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Products</h1>
        <div className="text-center py-8">Loading products...</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Products</h1>
        <Link
          href="/admin/products/create"
          className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
        >
          Create New Product
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {products.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No products found. Create your first product to get started.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4 font-medium">Product</th>
                <th className="text-left py-3 px-4 font-medium">Instructor</th>
                <th className="text-left py-3 px-4 font-medium">Price</th>
                <th className="text-left py-3 px-4 font-medium">Sessions</th>
                <th className="text-left py-3 px-4 font-medium">Providers</th>
                <th className="text-left py-3 px-4 font-medium">Status</th>
                <th className="text-left py-3 px-4 font-medium">Created</th>
                <th className="text-left py-3 px-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-b hover:bg-muted/30">
                  <td className="py-3 px-4">
                    <div className="font-medium">{product.title}</div>
                    {product.description && (
                      <div className="text-sm text-muted-foreground truncate max-w-xs">
                        {product.description}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4">{product.mentorName}</td>
                  <td className="py-3 px-4">
                    {new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: "USD",
                    }).format(parseFloat(product.price))}
                  </td>
                  <td className="py-3 px-4">{product.sessionsPerPack}</td>
                  <td className="py-3 px-4">
                    {getProviderBadges(product.stripePriceId, product.paypalProductId)}
                  </td>
                  <td className="py-3 px-4">{getStatusBadge(product.active)}</td>
                  <td className="py-3 px-4 text-sm">
                    {new Date(product.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4">
                    <Link
                      href={`/admin/products/${product.id}/edit`}
                      className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}