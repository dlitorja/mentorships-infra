"use client";

import React, { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, CheckCircle2, XCircle, ExternalLink, CreditCard, Wallet } from "lucide-react";
import Link from "next/link";
import { fetchMentors, createProduct, createProductFromStripe, type MentorshipType } from "@/lib/queries/api-client";

type ProductCreationResult = {
  success: boolean;
  message: string;
  product?: {
    id: string;
    title: string;
    price: string;
    currency: string;
    sessionsPerPack: number;
    validityDays: number;
    mentorshipType: string;
    stripe: {
      productId: string;
      productLink: string;
      priceId: string;
      priceLink: string;
    } | null;
    paypal: {
      productId: string;
      productLink: string;
    } | null;
  };
};

export function CreateProductForm() {
  const [activeTab, setActiveTab] = useState("create-new");
  const [result, setResult] = useState<ProductCreationResult | null>(null);

  const { data: mentorsData, isLoading: isLoadingMentors } = useQuery({
    queryKey: ["mentors"],
    queryFn: fetchMentors,
  });

  const mentors = mentorsData?.items || [];

  const createProductMutation = useMutation({
    mutationFn: async (data: {
      mentorId: string;
      title: string;
      description?: string;
      imageUrl?: string;
      price: string;
      currency?: string;
      sessionsPerPack: number;
      validityDays: number;
      mentorshipType: MentorshipType;
      enableStripe: boolean;
      enablePayPal: boolean;
    }) => createProduct(data),
    onSuccess: (data) => {
      setResult({
        success: true,
        message: data.message || "Product created successfully",
        product: data.product,
      });
    },
    onError: (error) => {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to create product",
      });
    },
  });

  const importFromStripeMutation = useMutation({
    mutationFn: async (data: { productId?: string; priceId?: string; enablePayPal?: boolean; mentorId?: string }) => {
      await createProductFromStripe({
        productId: data.productId,
        priceId: data.priceId,
        mentorId: data.mentorId,
      });
    },
    onSuccess: () => {
      setResult({
        success: true,
        message: "Product imported from Stripe successfully",
      });
    },
    onError: (error) => {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to import product",
      });
    },
  });

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Create Product</h1>
            <p className="text-muted-foreground mt-1">
              Create a new mentorship session pack or import from Stripe
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/admin/products">View Products</Link>
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="create-new">Create New Product</TabsTrigger>
            <TabsTrigger value="import-stripe">Import from Stripe</TabsTrigger>
          </TabsList>

          <TabsContent value="create-new">
            <CreateNewProductForm
              mentors={mentors}
              isLoadingMentors={isLoadingMentors}
              isSubmitting={createProductMutation.isPending}
              onSubmit={(values) => {
                setResult(null);
                createProductMutation.mutate(values);
              }}
            />
          </TabsContent>

          <TabsContent value="import-stripe">
            <ImportFromStripeForm
              mentors={mentors}
              isLoadingMentors={isLoadingMentors}
              isSubmitting={importFromStripeMutation.isPending}
              onSubmit={(values) => {
                setResult(null);
                importFromStripeMutation.mutate(values);
              }}
            />
          </TabsContent>
        </Tabs>

        {result && (
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

                    <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                        Use this ID for checkout:
                      </p>
                      <code className="text-lg font-mono bg-white dark:bg-gray-900 px-3 py-2 rounded border">
                        {result.product.id}
                      </code>
                    </div>

                    <div className="flex gap-3">
                      <Button onClick={() => setResult(null)}>
                        Create Another Product
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
        )}
      </div>
    </div>
  );
}

type Mentor = {
  id: string;
  email: string | null;
};

type CreateNewProductFormProps = {
  mentors: Mentor[];
  isLoadingMentors: boolean;
  isSubmitting: boolean;
  onSubmit: (values: {
    mentorId: string;
    title: string;
    description?: string;
    imageUrl?: string;
    price: string;
    currency?: string;
    sessionsPerPack: number;
    validityDays: number;
    mentorshipType: MentorshipType;
    enableStripe: boolean;
    enablePayPal: boolean;
  }) => void;
};

function CreateNewProductForm({
  mentors,
  isLoadingMentors,
  isSubmitting,
  onSubmit,
}: CreateNewProductFormProps) {
  const form = useForm({
    defaultValues: {
      mentorId: "",
      title: "",
      description: "",
      imageUrl: "",
      price: "",
      currency: "usd",
      sessionsPerPack: 4,
      validityDays: 30,
      mentorshipType: "one-on-one" as MentorshipType,
      enableStripe: true,
      enablePayPal: true,
    },
    onSubmit: async ({ value }) => {
      onSubmit({
        mentorId: value.mentorId,
        title: value.title,
        description: value.description || undefined,
        imageUrl: value.imageUrl || undefined,
        price: value.price,
        currency: value.currency,
        sessionsPerPack: value.sessionsPerPack,
        validityDays: value.validityDays,
        mentorshipType: value.mentorshipType,
        enableStripe: value.enableStripe,
        enablePayPal: value.enablePayPal,
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create New Product</CardTitle>
        <CardDescription>
          Create a new mentorship session pack with full customization
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <form.Field name="mentorId">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Mentor *</Label>
                  <Select
                    value={field.state.value}
                    onValueChange={field.handleChange}
                    disabled={isLoadingMentors}
                  >
                    <SelectTrigger id={field.name}>
                      <SelectValue placeholder="Select a mentor" />
                    </SelectTrigger>
                    <SelectContent>
                      {mentors.map((mentor) => (
                        <SelectItem key={mentor.id} value={mentor.id}>
                          {mentor.email || mentor.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>

            <form.Field name="mentorshipType">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Mentorship Type *</Label>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v as MentorshipType)}
                  >
                    <SelectTrigger id={field.name}>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="one-on-one">1-on-1 Mentorship</SelectItem>
                      <SelectItem value="group">Group Mentorship</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>
          </div>

          <form.Field name="title">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Product Title *</Label>
                <Input
                  id={field.name}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="e.g., 4-Session Mentorship Pack"
                  disabled={isSubmitting}
                />
              </div>
            )}
          </form.Field>

          <form.Field name="description">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Description</Label>
                <Textarea
                  id={field.name}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Optional description for this product"
                  rows={3}
                  disabled={isSubmitting}
                />
              </div>
            )}
          </form.Field>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <form.Field name="price">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Price (USD) *</Label>
                  <Input
                    id={field.name}
                    type="number"
                    step="0.01"
                    min="0"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="199.00"
                    disabled={isSubmitting}
                  />
                </div>
              )}
            </form.Field>

            <form.Field name="sessionsPerPack">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Sessions per Pack *</Label>
                  <Input
                    id={field.name}
                    type="number"
                    min="1"
                    max="100"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(parseInt(e.target.value) || 1)}
                    disabled={isSubmitting}
                  />
                </div>
              )}
            </form.Field>

            <form.Field name="validityDays">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Validity (days) *</Label>
                  <Input
                    id={field.name}
                    type="number"
                    min="1"
                    max="365"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(parseInt(e.target.value) || 30)}
                    disabled={isSubmitting}
                  />
                </div>
              )}
            </form.Field>
          </div>

          <form.Field name="imageUrl">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Product Image URL</Label>
                <Input
                  id={field.name}
                  type="url"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="https://example.com/image.jpg"
                  disabled={isSubmitting}
                />
                <p className="text-sm text-muted-foreground">
                  Optional: Add an image URL for this product
                </p>
              </div>
            )}
          </form.Field>

          <div className="border-t pt-6">
            <h3 className="font-semibold mb-4">Payment Providers</h3>
            <div className="flex flex-col gap-3">
              <form.Field name="enableStripe">
                {(field) => (
                  <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={field.state.value}
                      onChange={(e) => field.handleChange(e.target.checked)}
                      className="h-4 w-4"
                      disabled={isSubmitting}
                    />
                    <CreditCard className="h-5 w-5 text-purple-600" />
                    <div>
                      <span className="font-medium">Enable Stripe</span>
                      <p className="text-sm text-muted-foreground">
                        Create product in Stripe automatically
                      </p>
                    </div>
                  </label>
                )}
              </form.Field>

              <form.Field name="enablePayPal">
                {(field) => (
                  <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={field.state.value}
                      onChange={(e) => field.handleChange(e.target.checked)}
                      className="h-4 w-4"
                      disabled={isSubmitting}
                    />
                    <Wallet className="h-5 w-5 text-blue-600" />
                    <div>
                      <span className="font-medium">Enable PayPal</span>
                      <p className="text-sm text-muted-foreground">
                        Create product in PayPal automatically
                      </p>
                    </div>
                  </label>
                )}
              </form.Field>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              disabled={
                isSubmitting ||
                isLoadingMentors ||
                !form.state.values.mentorId ||
                !form.state.values.title ||
                !form.state.values.price
              }
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Product"
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

type ImportFromStripeFormProps = {
  mentors: Mentor[];
  isLoadingMentors: boolean;
  isSubmitting: boolean;
  onSubmit: (values: { productId?: string; priceId?: string; enablePayPal?: boolean; mentorId?: string }) => void;
};

function ImportFromStripeForm({
  mentors,
  isLoadingMentors,
  isSubmitting,
  onSubmit,
}: ImportFromStripeFormProps) {
  const form = useForm({
    defaultValues: {
      productId: "",
      priceId: "",
      enablePayPal: false,
      mentorId: "",
    },
    onSubmit: async ({ value }) => {
      onSubmit({
        productId: value.productId.trim() || undefined,
        priceId: value.priceId.trim() || undefined,
        enablePayPal: value.enablePayPal,
        mentorId: value.mentorId || undefined,
      });
    },
  });

  const hasAtLeastOneField = form.state.values.productId || form.state.values.priceId;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import from Stripe</CardTitle>
        <CardDescription>
          Import an existing Stripe product into the database
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
          <form.Field name="mentorId">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Assign to Mentor (optional)</Label>
                <Select
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  disabled={isLoadingMentors}
                >
                  <SelectTrigger id={field.name}>
                    <SelectValue placeholder="Select a mentor (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No mentor assigned</SelectItem>
                    {mentors.map((mentor) => (
                      <SelectItem key={mentor.id} value={mentor.id}>
                        {mentor.email || mentor.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>

          <form.Field name="productId">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Stripe Product ID</Label>
                <Input
                  id={field.name}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="prod_..."
                  disabled={isSubmitting}
                />
                <p className="text-sm text-muted-foreground">
                  Enter a Stripe Product ID (e.g., prod_TYUOiS4yHJjj42)
                </p>
              </div>
            )}
          </form.Field>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          <form.Field name="priceId">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Stripe Price ID</Label>
                <Input
                  id={field.name}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="price_..."
                  disabled={isSubmitting}
                />
                <p className="text-sm text-muted-foreground">
                  Enter a Stripe Price ID directly
                </p>
              </div>
            )}
          </form.Field>

          <form.Field name="enablePayPal">
            {(field) => (
              <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={field.state.value}
                  onChange={(e) => field.handleChange(e.target.checked)}
                  className="h-4 w-4"
                  disabled={isSubmitting}
                />
                <Wallet className="h-5 w-5 text-blue-600" />
                <div>
                  <span className="font-medium">Also enable PayPal</span>
                  <p className="text-sm text-muted-foreground">
                    Enable PayPal checkout for this product
                  </p>
                </div>
              </label>
            )}
          </form.Field>

          <div className="flex gap-3">
            <Button
              type="submit"
              disabled={
                isSubmitting ||
                isLoadingMentors ||
                !hasAtLeastOneField
              }
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                "Import Product"
              )}
            </Button>
          </div>

          <div className="border-t pt-6">
            <h3 className="font-semibold mb-3">How to use:</h3>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Go to your Stripe Dashboard → Products</li>
              <li>Find your product (e.g., &quot;Ash Kirk 1-on-1 Mentorship&quot;)</li>
              <li>Copy the Product ID (starts with <code className="bg-muted px-1 py-0.5 rounded">prod_</code>)</li>
              <li>Paste it above and click &quot;Import Product&quot;</li>
              <li>Use the Database ID for checkout</li>
            </ol>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
