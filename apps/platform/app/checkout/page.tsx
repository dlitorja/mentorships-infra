"use client";

export const dynamic = "force-dynamic";

import React, { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
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
import { createCheckoutSession, createPayPalCheckoutSession } from "@/lib/queries/api-client";
import { usePublicInstructorBySlug } from "@/lib/queries/convex/use-instructors";
import { useProductsByInstructorId, usePublicActiveProducts, type Product } from "@/lib/queries/convex/use-products";
import { type PublicInstructor } from "@/lib/queries/convex/use-instructors";
import { Id } from "@/convex/_generated/dataModel";
import { clsx } from "clsx";
import { useUser } from "@clerk/nextjs";
import { Input } from "@/components/ui/input";
import { AvailabilityPreview } from "@/components/checkout/availability-preview";

type PaymentMethod = "stripe" | "paypal";

function CheckoutContent(): React.JSX.Element {
  const searchParams = useSearchParams();
  const router = useRouter();
  const instructorSlug = searchParams.get("instructor");
  const mentorshipType = searchParams.get("type"); // "one-on-one" or "group"

  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("stripe");
  const { isSignedIn, user } = useUser();
  const [email, setEmail] = useState<string>("");
  const [fullName, setFullName] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; fullName?: string }>({});

  const { data: instructorData, isLoading: isLoadingInstructor } = usePublicInstructorBySlug(
    instructorSlug || ""
  );

  const instructor: PublicInstructor | undefined = instructorData ?? undefined;
  const instructorId = instructor?.instructorId;

  const {
    data: productsData,
    isLoading: isLoadingProducts,
    error: productsError,
  } = useProductsByInstructorId(instructorId ?? "");

  const { data: publicProductsData } = usePublicActiveProducts();
  const sourceProducts: Product[] = instructorId ? (productsData ?? []) : (publicProductsData ?? []);
  const allProducts = sourceProducts.filter((p) => p.active);

  const productList = mentorshipType
    ? allProducts.filter((p) => p.mentorshipType === mentorshipType)
    : allProducts;

  const selectedProduct = productList.find((p) => p._id === selectedProductId);

  useEffect(() => {
    if (user) {
      const mail = user.primaryEmailAddress?.emailAddress || "";
      const name = user.fullName || [user.firstName, user.lastName].filter(Boolean).join(" ");
      setEmail(mail);
      setFullName(name);
      setFieldErrors({});
      setFormError(null);
    }
  }, [user]);

  // Reset payment method to a supported option when the selected product changes.
  // We intentionally do NOT include `paymentMethod` in the dependency array to avoid
  // a render loop; the effect only runs when the product selection changes.
  useEffect(() => {
    if (!selectedProduct) return;
    const hasStripe = Boolean(selectedProduct.stripePriceId);
    const hasPayPal = Boolean(selectedProduct.paypalProductId);
    if (hasStripe) {
      setPaymentMethod("stripe");
    } else if (hasPayPal) {
      setPaymentMethod("paypal");
    }
  }, [selectedProduct]);

  const validateGuestDetails = useCallback((): boolean => {
    if (isSignedIn) return true;
    const errors: { email?: string; fullName?: string } = {};
    if (!email.trim()) {
      errors.email = "Email is required";
    } else if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      errors.email = "Please enter a valid email address";
    }
    if (!fullName.trim()) {
      errors.fullName = "Full name is required";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [isSignedIn, email, fullName]);

  const checkoutMutation = useMutation({
    mutationFn: async (data: { productId: string; paymentMethod: PaymentMethod }) => {
      const guestEmail = isSignedIn ? undefined : email;
      const guestFullName = isSignedIn ? undefined : fullName;

      if (data.paymentMethod === "paypal") {
        return createPayPalCheckoutSession({
          productId: data.productId,
          email: guestEmail,
          fullName: guestFullName,
        });
      }

      return createCheckoutSession({
        productId: data.productId,
        email: guestEmail,
        fullName: guestFullName,
      });
    },
    onSuccess: (data) => {
      const url = data.url || ("checkoutUrl" in data ? data.checkoutUrl : undefined);
      if (url) {
        window.location.href = url;
      } else {
        throw new Error("No checkout URL returned");
      }
    },
  });

  const handleCheckout = () => {
    if (!selectedProduct) return;
    setFormError(null);
    if (!validateGuestDetails()) {
      setFormError("Please fill in your details before continuing.");
      return;
    }
    checkoutMutation.mutate({ productId: selectedProduct._id, paymentMethod });
  };

  const guestDetailsValid =
    isSignedIn ||
    Boolean(
      email.trim() &&
        /^\S+@\S+\.\S+$/.test(email.trim()) &&
        fullName.trim()
    );

  const canCheckout = Boolean(
    selectedProduct &&
      guestDetailsValid &&
      ((paymentMethod === "stripe" && selectedProduct.stripePriceId) ||
        (paymentMethod === "paypal" && selectedProduct.paypalProductId))
  );

  const error = checkoutMutation.error instanceof Error
    ? checkoutMutation.error.message
    : null;

  const loading = checkoutMutation.isPending;

  const isLoading = instructorSlug ? (isLoadingInstructor || isLoadingProducts) : isLoadingProducts;
  const instructorName = instructor?.name;

  if (isLoading) {
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

  if (!productList || productList.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
        <Card className="max-w-2xl w-full">
          <CardHeader>
            <CardTitle>Checkout</CardTitle>
            {instructorSlug ? (
              <CardDescription>No products available for this instructor</CardDescription>
            ) : (
              <CardDescription>No products available</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {instructorSlug ? (
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  This instructor currently has no active mentorship packages available for purchase.
                </p>
                <Button asChild variant="outline">
                  <Link href={`/instructors/${instructorSlug}`}>Back to Instructor Profile</Link>
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground">
                There are no session packs available for purchase at this time.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <Card className="max-w-2xl w-full">
        <CardHeader>
          <CardTitle>{instructorName ? "Checkout" : "Select a session pack"}</CardTitle>
          <CardDescription>
            {instructorName
              ? `Complete your purchase with ${instructorName}`
              : "Select a session pack to proceed with checkout"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <label className="text-sm font-medium">Select a Session Pack</label>
            <div className="grid gap-3">
              {productList.map((product) => {
                const isSelected = selectedProductId === product._id;
                const isAvailable = product.stripePriceId || product.paypalProductId;

                return (
                  <div
                    key={product._id}
                    onClick={() => isAvailable && setSelectedProductId(product._id)}
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

          {instructorId && (
            <AvailabilityPreview
              instructorId={instructorId as Id<"instructors">}
              instructorName={instructorName}
            />
          )}

          <div className="space-y-3">
            <label className="text-sm font-medium">Your Details</label>
            {!isSignedIn ? (
              <div className="grid gap-3">
                <div>
                  <label htmlFor="checkout-email" className="block text-sm mb-1">Email</label>
                  <Input
                    type="email"
                    id="checkout-email"
                    name="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (fieldErrors.email) {
                        setFieldErrors((prev) => ({ ...prev, email: undefined }));
                      }
                    }}
                    placeholder="you@example.com"
                    className="!bg-input !text-foreground"
                    aria-invalid={fieldErrors.email ? "true" : "false"}
                  />
                  {fieldErrors.email && (
                    <p className="text-sm text-red-600 mt-1">{fieldErrors.email}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="checkout-full-name" className="block text-sm mb-1">Full Name</label>
                  <Input
                    type="text"
                    id="checkout-full-name"
                    name="fullName"
                    value={fullName}
                    onChange={(e) => {
                      setFullName(e.target.value);
                      if (fieldErrors.fullName) {
                        setFieldErrors((prev) => ({ ...prev, fullName: undefined }));
                      }
                    }}
                    placeholder="Your full name"
                    className="!bg-input !text-foreground"
                    aria-invalid={fieldErrors.fullName ? "true" : "false"}
                  />
                  {fieldErrors.fullName && (
                    <p className="text-sm text-red-600 mt-1">{fieldErrors.fullName}</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Purchasing as {fullName || "signed-in user"} ({email})
              </div>
            )}
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
                  {selectedProduct.paypalProductId && (
                    <button
                      type="button"
                      onClick={() => setPaymentMethod("paypal")}
                      className={clsx(
                        "flex items-center justify-center gap-2 p-3 border rounded-lg transition-all",
                        paymentMethod === "paypal"
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "hover:border-muted-foreground/50"
                      )}
                    >
                      <Wallet className="h-5 w-5" />
                      <span className="font-medium">PayPal</span>
                    </button>
                  )}
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
                    <span className="font-medium">Due Now</span>
                    <span className="font-bold text-lg">${selectedProduct.price}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    via {paymentMethod === "stripe" ? "Stripe" : "PayPal"}
                  </div>
                </div>
              </div>
            </>
          )}

          {formError && (
            <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm">
              {formError}
            </div>
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
                  {selectedProduct ? `Pay $${selectedProduct.price}` : "Pay"}
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
            {process.env.NODE_ENV !== "production" && (
              <>
                <p>
                  <strong>Testing:</strong> Use Stripe test card{" "}
                  <code className="bg-muted px-1 rounded">4242 4242 4242 4242</code>
                </p>
                <p>
                  Any future expiry date, any CVC, any ZIP code
                </p>
              </>
            )}
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
