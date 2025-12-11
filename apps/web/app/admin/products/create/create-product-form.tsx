"use client";

import React, { useState } from "react";
import { useForm } from "@tanstack/react-form";
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
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { productFormSchema } from "@/lib/validation-schemas";

export function CreateProductForm() {
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    product?: {
      id: string;
      title: string;
      price: string;
      stripePriceId: string;
    };
  } | null>(null);

  const form = useForm({
    defaultValues: {
      stripeProductId: "",
      stripePriceId: "",
    },
    onSubmit: async ({ value }) => {
      // Validate that at least one field is provided
      const validationResult = productFormSchema.safeParse(value);
      if (!validationResult.success) {
        setResult({
          success: false,
          message: validationResult.error.errors[0]?.message || "Either Stripe Product ID or Price ID is required",
        });
        return;
      }

      setResult(null);

      try {
        const response = await fetch("/api/products/create-from-stripe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            productId: value.stripeProductId.trim() || undefined,
            priceId: value.stripePriceId.trim() || undefined,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to create product");
        }

        setResult({
          success: true,
          message: data.message || "Product created successfully",
          product: data.product,
        });

        // Clear form on success
        form.reset();
      } catch (error) {
        setResult({
          success: false,
          message: error instanceof Error ? error.message : "Failed to create product",
        });
      }
    },
  });

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <Card className="max-w-2xl w-full">
        <CardHeader>
          <CardTitle>Create Product from Stripe</CardTitle>
          <CardDescription>
            Create a database product from your Stripe product or price ID
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            className="space-y-6"
          >
            <form.Field name="stripeProductId">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Stripe Product ID (optional)</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="prod_..."
                    disabled={form.state.isSubmitting}
                  />
                  <p className="text-sm text-muted-foreground">
                    Enter a Stripe Product ID (e.g., prod_TYUOiS4yHJjj42). The default price will be used.
                  </p>
                </div>
              )}
            </form.Field>

            <form.Field name="stripePriceId">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Stripe Price ID (optional)</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="price_..."
                    disabled={form.state.isSubmitting}
                    aria-invalid={field.state.meta.errors.length > 0}
                    aria-describedby={
                      field.state.meta.errors.length > 0
                        ? `${field.name}-error`
                        : undefined
                    }
                  />
                  <p className="text-sm text-muted-foreground">
                    Or enter a Stripe Price ID directly (e.g., price_...). One of Product ID or Price ID is required.
                  </p>
                  {field.state.meta.errors.length > 0 && (
                    <p
                      id={`${field.name}-error`}
                      className="text-sm text-red-600 dark:text-red-400"
                    >
                      {field.state.meta.errors[0]}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            {result && (
              <div
                className={`p-4 rounded-lg ${
                  result.success
                    ? "bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800"
                    : "bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800"
                }`}
              >
                <div className="flex items-start gap-2">
                  {result.success ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <p
                      className={`font-medium ${
                        result.success
                          ? "text-green-900 dark:text-green-100"
                          : "text-red-900 dark:text-red-100"
                      }`}
                    >
                      {result.message}
                    </p>
                    {result.success && result.product && (
                      <div className="mt-3 space-y-2 text-sm">
                        <div className="bg-white dark:bg-gray-900 p-3 rounded border">
                          <p className="font-semibold mb-2">Product Created:</p>
                          <div className="space-y-1">
                            <p>
                              <span className="text-muted-foreground">Database ID:</span>{" "}
                              <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">
                                {result.product.id}
                              </code>
                            </p>
                            <p>
                              <span className="text-muted-foreground">Title:</span>{" "}
                              {result.product.title}
                            </p>
                            <p>
                              <span className="text-muted-foreground">Price:</span> $
                              {result.product.price}
                            </p>
                            <p>
                              <span className="text-muted-foreground">Stripe Price ID:</span>{" "}
                              <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">
                                {result.product.stripePriceId}
                              </code>
                            </p>
                          </div>
                        </div>
                        <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded border border-blue-200 dark:border-blue-800">
                          <p className="font-semibold text-blue-900 dark:text-blue-100 mb-1">
                            ✅ Use this ID for checkout:
                          </p>
                          <code className="bg-white dark:bg-gray-900 px-2 py-1 rounded text-xs font-mono block">
                            {result.product.id}
                          </code>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={
                  form.state.isSubmitting ||
                  (!form.state.values.stripeProductId && !form.state.values.stripePriceId)
                }
              >
                {form.state.isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Product"
                )}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href="/checkout">Go to Checkout</Link>
              </Button>
            </div>
          </form>

          <div className="mt-6 pt-6 border-t">
            <h3 className="font-semibold mb-2">How to use:</h3>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Go to your Stripe Dashboard → Products</li>
              <li>Find your product (e.g., "Ash Kirk 1-on-1 Mentorship")</li>
              <li>Copy the Product ID (starts with <code>prod_</code>)</li>
              <li>Paste it above and click "Create Product"</li>
              <li>Copy the Database ID and use it in the checkout page</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

