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
import { Loader2, Check, CreditCard, Wallet } from "lucide-react";
import Link from "next/link";
import { queryKeys } from "@/lib/queries/query-keys";
import { fetchProducts, fetchProduct, createCheckoutSession } from "@/lib/queries/api-client";
import { clsx } from "clsx";

type Product = {
  id: string;
  title: string;
  price: string;
  sessionsPerPack: number;
  validityDays: number;
  stripePriceId: string | null;
  paypalProductId: string | null;
  mentorId: string;
};

type PaymentMethod = "stripe" | "paypal";

function CheckoutContent(): React.JSX.Element {
  const searchParams = useSearchParams();
  const router = useRouter();
  const instructorSlug = searchParams.get("instructor");
  
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("stripe");

  const {
    data: productsData,
    isLoading: isLoadingProducts,
    error: productsError,
  } = useQuery({
    queryKey: queryKeys.products.list,
    queryFn: fetchProducts,
  });

  const products: Product[] = productsData?.items || [];

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  const checkoutMutation = useMutation({
    mutationFn: async (data: { packId: string; paymentMethod: PaymentMethod }) => {
      if (data.paymentMethod === "paypal") {
        const response = await fetch("/api/checkout/paypal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ packId: data.packId }),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: "PayPal checkout failed" }));
          throw new Error(error.error || "PayPal checkout failed");
        }
        return response.json();
      }
      return createCheckoutSession({ packId: data.packId });
    },
    onSuccess: (data) => {
      const url = data.url || data.approvalUrl;
      if (url) {
        window.location.href = url;
      } else {
        throw new Error("No checkout URL returned");
      }
    },
  });

  const handleCheckout = () => {
    if (!selectedProduct) return;
    checkoutMutation.mutate({ packId: selectedProduct.id, paymentMethod });
  };

  const canCheckout = selectedProduct && (
    (paymentMethod === "stripe" && selectedProduct.stripePriceId) ||
    (paymentMethod === "paypal" && selectedProduct.paypalProductId)
  );

  const error = checkoutMutation.error instanceof Error
    ? checkoutMutation.error.message
    : null;

  const loading = checkoutMutation.isPending;

  if (isLoadingProducts) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
        <Card className="max-w-2xl w-full">
          <CardHeader>
            <CardTitle>Checkout</CardTitle>
            <CardDescription>Loading available products...</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (productsError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
        <Card className="max-w-2xl w-full">
          <CardHeader>
            <CardTitle>Checkout</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm">
              Failed to load products. Please try again.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
        <Card className="max-w-2xl w-full">
          <CardHeader>
            <CardTitle>Checkout</CardTitle>
            <CardDescription>No products available</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              There are no session packs available for purchase at this time.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <Card className="max-w-2xl w-full">
        <CardHeader>
          <CardTitle>Checkout</CardTitle>
          <CardDescription>
            {instructorSlug
              ? `Complete your purchase with ${instructorSlug}`
              : "Select a session pack to proceed with checkout"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <label className="text-sm font-medium">Select a Session Pack</label>
            <div className="grid gap-3">
              {products.map((product) => {
                const isSelected = selectedProductId === product.id;
                const isAvailable = product.stripePriceId || product.paypalProductId;
                
                return (
                  <div
                    key={product.id}
                    onClick={() => isAvailable && setSelectedProductId(product.id)}
                    className={clsx(
                      "border rounded-lg p-4 cursor-pointer transition-all",
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "hover:border-muted-foreground/50",
                      !isAvailable && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <h3 className="font-semibold">{product.title}</h3>
                        <p className="text-sm text-muted-foreground">
                          {product.sessionsPerPack} sessions • Valid for {product.validityDays} days
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-lg">${product.price}</p>
                        {!product.stripePriceId && !product.paypalProductId && (
                          <p className="text-xs text-destructive">Not available</p>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <div className="mt-3 flex items-center gap-2 text-primary">
                        <Check className="h-4 w-4" />
                        <span className="text-sm font-medium">Selected</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {selectedProduct && (
            <>
              <div className="space-y-3">
                <label className="text-sm font-medium">Payment Method</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("stripe")}
                    disabled={!selectedProduct.stripePriceId}
                    className={clsx(
                      "flex items-center justify-center gap-2 p-3 border rounded-lg transition-all",
                      paymentMethod === "stripe"
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "hover:border-muted-foreground/50",
                      !selectedProduct.stripePriceId && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <CreditCard className="h-5 w-5" />
                    <span className="font-medium">Stripe</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("paypal")}
                    disabled={!selectedProduct.paypalProductId}
                    className={clsx(
                      "flex items-center justify-center gap-2 p-3 border rounded-lg transition-all",
                      paymentMethod === "paypal"
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "hover:border-muted-foreground/50",
                      !selectedProduct.paypalProductId && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <Wallet className="h-5 w-5" />
                    <span className="font-medium">PayPal</span>
                  </button>
                </div>
              </div>

              <div className="border rounded-lg p-4 bg-muted/50">
                <h3 className="font-semibold mb-2">Order Summary</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Product</span>
                    <span className="font-medium">{selectedProduct.title}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sessions</span>
                    <span className="font-medium">{selectedProduct.sessionsPerPack}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Valid for</span>
                    <span className="font-medium">{selectedProduct.validityDays} days</span>
                  </div>
                  <div className="border-t pt-2 flex justify-between">
                    <span className="font-medium">Total</span>
                    <span className="font-bold text-lg">${selectedProduct.price}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    via {paymentMethod === "stripe" ? "Stripe" : "PayPal"}
                  </div>
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={handleCheckout}
              disabled={!canCheckout || loading}
              className="flex-1"
              size="lg"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  {paymentMethod === "stripe" ? "Pay with Stripe" : "Pay with PayPal"}
                </>
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

          <div className="text-sm text-muted-foreground space-y-1">
            <p>
              <strong>Testing:</strong> Use Stripe test card{" "}
              <code className="bg-muted px-1 rounded">4242 4242 4242 4242</code>
            </p>
            <p>
              Any future expiry date, any CVC, any ZIP code
            </p>
          </div>

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