"use client";

import React, { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { queryKeys } from "@/lib/queries/query-keys";
import { fetchProduct, createCheckoutSession } from "@/lib/queries/api-client";

// Force dynamic rendering to prevent static generation issues with useSearchParams
export const dynamic = "force-dynamic";

function CheckoutContent(): React.JSX.Element {
  const searchParams = useSearchParams();
  const router = useRouter();
  const instructorSlug = searchParams.get("instructor");
  const packIdParam = searchParams.get("packId");

  const [packId, setPackId] = useState(packIdParam || "");

  // Fetch product using TanStack Query
  const {
    data: product,
    isLoading: isLoadingProduct,
    error: productError,
    refetch: refetchProduct,
  } = useQuery({
    queryKey: queryKeys.products.detail(packId),
    queryFn: () => fetchProduct(packId),
    enabled: !!packId && packId.trim() !== "",
  });

  // Checkout mutation
  const checkoutMutation = useMutation({
    mutationFn: (data: { packId: string }) => createCheckoutSession(data),
    onSuccess: (data) => {
      // Redirect to Stripe checkout
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL returned");
      }
    },
  });

  const handleCheckout = () => {
    if (!packId.trim()) {
      return;
    }

    if (!product) {
      return;
    }

    if (!product.stripePriceId) {
      return;
    }

    checkoutMutation.mutate({ packId: product.id });
  };

  // Determine error message
  const error =
    productError instanceof Error
      ? productError.message
      : checkoutMutation.error instanceof Error
        ? checkoutMutation.error.message
        : null;

  const loading = checkoutMutation.isPending;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <Card className="max-w-2xl w-full">
        <CardHeader>
          <CardTitle>Checkout</CardTitle>
          <CardDescription>
            {instructorSlug
              ? `Complete your purchase for ${instructorSlug}`
              : "Enter product details to proceed with checkout"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Product ID Input */}
          <div className="space-y-2">
            <Label htmlFor="packId">Product ID</Label>
            <div className="flex gap-2">
              <Input
                id="packId"
                value={packId}
                onChange={(e) => setPackId(e.target.value)}
                placeholder="Enter product ID (UUID)"
                disabled={loading}
              />
              <Button
                onClick={() => refetchProduct()}
                disabled={!packId.trim() || loading || isLoadingProduct}
                variant="outline"
              >
                {isLoadingProduct ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  "Load"
                )}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Enter the product ID from your database to load product details
            </p>
          </div>

          {/* Product Details */}
          {product && (
            <div className="border rounded-lg p-4 space-y-3 bg-muted/50">
              <h3 className="font-semibold text-lg">Product Details</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Title:</span>
                  <p className="font-medium">{product.title}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Price:</span>
                  <p className="font-medium">${product.price}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Sessions:</span>
                  <p className="font-medium">{product.sessionsPerPack}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Validity:</span>
                  <p className="font-medium">{product.validityDays} days</p>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Stripe Price ID:</span>
                  <p className="font-medium font-mono text-xs">
                    {product.stripePriceId || "Not configured"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm">
              {error}
            </div>
          )}

          {/* Checkout Button */}
          <div className="flex gap-2">
            <Button
              onClick={handleCheckout}
              disabled={!product || !product.stripePriceId || loading}
              className="flex-1"
              size="lg"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                "Proceed to Stripe Checkout"
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => router.back()}
              disabled={loading}
            >
              Cancel
            </Button>
          </div>

          {/* Help Text */}
          <div className="text-sm text-muted-foreground space-y-1">
            <p>
              <strong>Testing:</strong> Use Stripe test card{" "}
              <code className="bg-muted px-1 rounded">4242 4242 4242 4242</code>
            </p>
            <p>
              Any future expiry date, any CVC, any ZIP code
            </p>
          </div>

          {/* Back Link */}
          {instructorSlug && (
            <div className="pt-4 border-t">
              <Link
                href={`/instructors/${instructorSlug}`}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                ← Back to instructor profile
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function CheckoutPage(): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
          <Card className="max-w-2xl w-full">
            <CardHeader>
              <CardTitle>Checkout</CardTitle>
              <CardDescription>Loading...</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}

