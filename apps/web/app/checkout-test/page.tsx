"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import Link from "next/link";

/**
 * Test page for Stripe checkout flow
 * 
 * This page allows you to test the checkout flow by clicking a button
 * that will create a checkout session and redirect to Stripe.
 */
export default function CheckoutTestPage() {
  const { isSignedIn, isLoaded } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);

  // Product ID we created
  const productId = "24cfcc67-ff04-4d57-a702-b0e8c55bbb23";

  const handleCheckout = async () => {
    setLoading(true);
    setError(null);
    setOrderId(null);

    try {
      const response = await fetch("/api/checkout/stripe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create checkout session");
      }

      if (data.checkoutUrl) {
        setOrderId(data.orderId);
        // Redirect to Stripe Checkout
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error occurred");
      setLoading(false);
    }
  };

  // Show loading state while checking auth
  if (!isLoaded) {
    return (
      <div className="container mx-auto p-8 max-w-2xl">
        <Card>
          <CardContent className="p-8">
            <div className="flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show sign-in prompt if not authenticated
  if (!isSignedIn) {
    return (
      <div className="container mx-auto p-8 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Authentication Required</CardTitle>
            <CardDescription>
              You need to be signed in to test the checkout flow.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4">
              <Button asChild>
                <Link href="/sign-in">Sign In</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/sign-up">Sign Up</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-8 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Test Stripe Checkout</CardTitle>
          <CardDescription>
            Click the button below to test the checkout flow. This will create a checkout session
            and redirect you to Stripe's hosted checkout page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              <strong>Product ID:</strong> {productId}
            </p>
            <p className="text-sm text-muted-foreground">
              <strong>Product:</strong> Ash Kirk 1-on-1 Mentorship (4 sessions)
            </p>
            <p className="text-sm text-muted-foreground">
              <strong>Price:</strong> $375.00
            </p>
          </div>

          {error && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md">
              <p className="text-sm text-destructive font-medium">Error:</p>
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {orderId && (
            <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-md">
              <p className="text-sm text-green-700 dark:text-green-400 font-medium">
                ✅ Order created: {orderId}
              </p>
              <p className="text-sm text-green-700 dark:text-green-400">
                Redirecting to Stripe Checkout...
              </p>
            </div>
          )}

          <Button
            onClick={handleCheckout}
            disabled={loading}
            className="w-full"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating checkout session...
              </>
            ) : (
              "Start Checkout Test"
            )}
          </Button>

          <div className="mt-6 p-4 bg-muted rounded-md">
            <p className="text-sm font-medium mb-2">Testing Instructions:</p>
            <ol className="text-sm space-y-1 list-decimal list-inside text-muted-foreground">
              <li>Make sure you're signed in (Clerk authentication required)</li>
              <li>Click the button above to create a checkout session</li>
              <li>You'll be redirected to Stripe Checkout</li>
              <li>Use test card: <code className="bg-background px-1 rounded">4242 4242 4242 4242</code></li>
              <li>Complete the payment to test the webhook flow</li>
              <li>Check Supabase to verify records were created</li>
            </ol>
          </div>

          <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-md">
            <p className="text-sm font-medium text-blue-700 dark:text-blue-400 mb-1">
              ⚠️ Prerequisites:
            </p>
            <ul className="text-sm space-y-1 list-disc list-inside text-blue-700 dark:text-blue-400">
              <li>Stripe API keys must be set in <code>.env.local</code></li>
              <li>Stripe CLI should be running for webhook testing</li>
              <li>You must be authenticated (signed in)</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

