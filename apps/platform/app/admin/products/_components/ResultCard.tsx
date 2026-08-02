'use client';

import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, CreditCard, Wallet, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ProductUpdateResult } from "./types";

interface ResultCardProps {
  result: ProductUpdateResult | null;
  mode: "create" | "edit";
  onDismiss: () => void;
}

export function ResultCard({ result, mode, onDismiss }: ResultCardProps) {
  if (!result) return null;

  return (
    <div
      className={`mt-6 p-6 rounded-lg ${
        result.success
          ? "bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800"
          : "bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800"
      }`}
    >
      <div className="flex items-start gap-3">
        {result.success ? (
          <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400 mt-0.5" />
        ) : (
          <XCircle className="h-6 w-6 text-red-600 dark:text-red-400 mt-0.5" />
        )}
        <div className="flex-1">
          <p
            className={`font-semibold text-lg ${
              result.success
                ? "text-green-900 dark:text-green-100"
                : "text-red-900 dark:text-red-100"
            }`}
          >
            {result.message}
          </p>

          {result.success && result.product && (
            <div className="mt-4 space-y-4">
              <div className="bg-white dark:bg-gray-900 p-4 rounded-lg border">
                <h3 className="font-semibold mb-3">Product Details</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Title:</span>{" "}
                    <span className="font-medium">{result.product.title}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Price:</span>{" "}
                    <span className="font-medium">
                      ${result.product.price} {result.product.currency.toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Sessions:</span>{" "}
                    <span className="font-medium">{result.product.sessionsPerPack}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Validity:</span>{" "}
                    <span className="font-medium">{result.product.validityDays} days</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Type:</span>{" "}
                    <span className="font-medium capitalize">
                      {result.product.mentorshipType === "one-on-one" ? "1-on-1" : "Group"}
                    </span>
                  </div>
                </div>
              </div>

              {mode === "create" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {result.product.stripe && (
                    <div className="bg-purple-50 dark:bg-purple-950 p-4 rounded-lg border border-purple-200 dark:border-purple-800">
                      <div className="flex items-center gap-2 mb-3">
                        <CreditCard className="h-5 w-5 text-purple-600" />
                        <h4 className="font-semibold text-purple-900 dark:text-purple-100">
                          Stripe
                        </h4>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Product ID:</span>{" "}
                          <code className="bg-purple-100 dark:bg-purple-900 px-1.5 py-0.5 rounded text-xs">
                            {result.product.stripe.productId}
                          </code>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Price ID:</span>{" "}
                          <code className="bg-purple-100 dark:bg-purple-900 px-1.5 py-0.5 rounded text-xs">
                            {result.product.stripe.priceId}
                          </code>
                        </div>
                        <div className="flex gap-2 pt-2">
                          <a
                            href={result.product.stripe.productLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"
                          >
                            View Product <ExternalLink className="h-3 w-3" />
                          </a>
                          <a
                            href={result.product.stripe.priceLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"
                          >
                            View Price <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>
                    </div>
                  )}

                  {result.product.paypal && (
                    <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                      <div className="flex items-center gap-2 mb-3">
                        <Wallet className="h-5 w-5 text-blue-600" />
                        <h4 className="font-semibold text-blue-900 dark:text-blue-100">
                          PayPal
                        </h4>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Product ID:</span>{" "}
                          <code className="bg-blue-100 dark:bg-blue-900 px-1.5 py-0.5 rounded text-xs">
                            {result.product.paypal.productId}
                          </code>
                        </div>
                        <div>
                          <a
                            href={result.product.paypal.productLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                          >
                            View in PayPal Dashboard <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {mode === "create" && (
                <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                    Use this ID for checkout:
                  </p>
                  <code className="text-lg font-mono bg-white dark:bg-gray-900 px-3 py-2 rounded border">
                    {result.product.id}
                  </code>
                </div>
              )}

              <div className="flex gap-3">
                <Button onClick={onDismiss}>
                  {mode === "create" ? "Create Another Product" : "Update Again"}
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/admin/products">View All Products</Link>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
