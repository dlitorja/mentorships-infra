"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { z } from "zod";
import { ExternalLink, CreditCard, Wallet, Search, ChevronLeft, ChevronRight, Loader2, Trash2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type InstructorOption = {
  id: string;
  userId: string | null;
  email: string | null;
};

const instructorOptionSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  slug: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  activeMenteeCount: z.number(),
  totalCompletedSessions: z.number(),
});

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
  paypalProductLink: string | null;
  active: boolean;
  createdAt: string;
};

const productSchema = z.object({
  id: z.string(),
  mentorId: z.string(),
  mentorName: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  price: z.string(),
  currency: z.string(),
  sessionsPerPack: z.number(),
  validityDays: z.number(),
  mentorshipType: z.string(),
  stripePriceId: z.string().nullable(),
  stripeProductId: z.string().nullable(),
  paypalProductId: z.string().nullable(),
  paypalProductLink: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
});

const productsResponseSchema = z.object({
  items: z.array(productSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  error: z.string().optional(),
});

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [instructors, setInstructors] = useState<InstructorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [mentorId, setMentorId] = useState("");
  const [mentorshipType, setMentorshipType] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  const [productToDelete, setProductToDelete] = useState<ProductInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchInstructors = async () => {
    try {
      const res = await fetch("/api/admin/instructors?pageSize=100");
      const json = await res.json();
      const parsed = instructorOptionSchema.array().safeParse(json.items);
      if (res.ok && parsed.success) {
        setInstructors(parsed.data);
      }
    } catch (err) {
      console.error("Error fetching instructors:", err);
    }
  };

  useEffect(() => {
    fetchInstructors();
  }, []);

  const fetchProducts = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("pageSize", pageSize.toString());
      if (search) params.set("search", search);
      if (mentorId) params.set("mentorId", mentorId);
      if (mentorshipType) params.set("mentorshipType", mentorshipType);
      if (activeFilter) params.set("active", activeFilter);

      const res = await fetch(`/api/admin/products?${params}`);
      const json = await res.json();
      const parsed = productsResponseSchema.safeParse(json);
      
      if (!res.ok) {
        throw new Error(parsed.success ? parsed.data.error : "Failed to fetch products");
      }
      
      if (!parsed.success) {
        console.error("Invalid API response:", parsed.error);
        throw new Error("Invalid API response");
      }
      
      setProducts(parsed.data.items);
      setTotal(parsed.data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch products");
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, [page, mentorId, mentorshipType, activeFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, mentorId, mentorshipType, activeFilter]);

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  const handleDeleteClick = (product: ProductInfo) => {
    setProductToDelete(product);
    setDeleteError(null);
  };

  const handleDeleteConfirm = async () => {
    if (!productToDelete) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch(`/api/admin/products/${productToDelete.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete product");
      }

      setProductToDelete(null);
      fetchProducts();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete product");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setProductToDelete(null);
    setDeleteError(null);
  };

  const totalPages = Math.ceil(total / pageSize);

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

  const getMentorshipTypeBadge = (type: string) => {
    const isOneOnOne = type === "one-on-one";
    return (
      <span
        className={`px-2 py-1 rounded-full text-xs font-medium ${
          isOneOnOne
            ? "bg-orange-100 text-orange-800"
            : "bg-teal-100 text-teal-800"
        }`}
      >
        {isOneOnOne ? "1-on-1" : "Group"}
      </span>
    );
  };

  const getProviderBadges = (
    stripeProductId: string | null,
    paypalProductId: string | null,
    paypalProductLink: string | null
  ) => {
    const badges = [];
    if (stripeProductId) {
      badges.push(
        <a
          key="stripe"
          href={`https://dashboard.stripe.com/products/${stripeProductId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800 hover:bg-purple-200 flex items-center gap-1"
          title="View in Stripe"
        >
          <CreditCard className="h-3 w-3" />
          Stripe
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      );
    }
    if (paypalProductId && paypalProductLink) {
      badges.push(
        <a
          key="paypal"
          href={paypalProductLink}
          target="_blank"
          rel="noopener noreferrer"
          className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 flex items-center gap-1"
          title="View in PayPal"
        >
          <Wallet className="h-3 w-3" />
          PayPal
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      );
    }
    return badges.length > 0 ? (
      <div className="flex gap-1 flex-wrap">{badges}</div>
    ) : (
      <span className="text-muted-foreground text-sm">None</span>
    );
  };

  if (initialLoading) {
    return (
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Products</h1>
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Products</h1>
        <p className="text-muted-foreground mt-1">
          Manage mentorship products and pricing
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <form onSubmit={handleSearch} className="flex gap-2 flex-1 max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search by title or description..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button type="submit" variant="secondary">Search</Button>
            </form>

            <select
              value={mentorId}
              onChange={(e) => {
                setMentorId(e.target.value);
                setPage(1);
              }}
              className="p-2 border rounded-md"
            >
              <option value="">All Instructors</option>
              {instructors.map((instructor) => (
                <option key={instructor.id} value={instructor.id}>
                  {instructor.email || (instructor.userId ? instructor.userId.slice(0, 8) + "..." : "No email")}
                </option>
              ))}
            </select>

            <select
              value={mentorshipType}
              onChange={(e) => {
                setMentorshipType(e.target.value);
                setPage(1);
              }}
              className="p-2 border rounded-md"
            >
              <option value="">All Types</option>
              <option value="one-on-one">1-on-1</option>
              <option value="group">Group</option>
            </select>

            <select
              value={activeFilter}
              onChange={(e) => {
                setActiveFilter(e.target.value);
                setPage(1);
              }}
              className="p-2 border rounded-md"
            >
              <option value="">All Status</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Header with Create button */}
      <div className="flex items-center justify-end">
        <Link
          href="/admin/products/create"
          className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
        >
          Create New Product
        </Link>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading products...</span>
        </div>
      )}

      {!loading && products.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No products found. Create your first product to get started.
        </div>
      ) : !loading && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4 font-medium">Product</th>
                <th className="text-left py-3 px-4 font-medium">Type</th>
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
                    <div className="flex items-center gap-3">
                      {product.imageUrl && (
                        <img
                          src={product.imageUrl}
                          alt={product.title}
                          className="h-10 w-10 rounded object-cover"
                        />
                      )}
                      <div>
                        <div className="font-medium">{product.title}</div>
                        {product.description && (
                          <div className="text-sm text-muted-foreground truncate max-w-xs">
                            {product.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {getMentorshipTypeBadge(product.mentorshipType)}
                  </td>
                  <td className="py-3 px-4">{product.mentorName}</td>
                  <td className="py-3 px-4">
                    {new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: product.currency?.toUpperCase() || "USD",
                    }).format(parseFloat(product.price))}
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm">{product.sessionsPerPack}</span>
                    <span className="text-xs text-muted-foreground ml-1">
                      / {product.validityDays}d
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {getProviderBadges(
                      product.stripeProductId,
                      product.paypalProductId,
                      product.paypalProductLink
                    )}
                  </td>
                  <td className="py-3 px-4">{getStatusBadge(product.active)}</td>
                  <td className="py-3 px-4 text-sm">
                    {new Date(product.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/admin/products/${product.id}/edit`}
                        className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        Edit
                      </Link>
                      <button
                        onClick={() => handleDeleteClick(product)}
                        className="text-sm text-red-600 hover:text-red-800 hover:underline"
                      >
                        Delete
                      </button>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                        {product.id.slice(0, 8)}...
                      </code>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {((page - 1) * pageSize) + 1} to {Math.min(page * pageSize, total)} of {total} products
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!productToDelete} onOpenChange={() => handleDeleteCancel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Delete Product
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this product? This action will:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Archive the product in Stripe (it cannot be used for new purchases)</li>
              <li>Archive the associated Stripe price</li>
              <li>Mark the product as deleted in the database</li>
            </ul>
            {productToDelete && (
              <div className="mt-3 p-3 bg-muted rounded-lg">
                <p className="font-medium">{productToDelete.title}</p>
                <p className="text-sm text-muted-foreground">
                  {productToDelete.stripeProductId && `Stripe Product: ${productToDelete.stripeProductId}`}
                </p>
              </div>
            )}
            {deleteError && (
              <div className="mt-2 p-2 bg-red-50 border border-red-200 text-red-800 rounded text-sm">
                {deleteError}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={handleDeleteCancel} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Product
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
