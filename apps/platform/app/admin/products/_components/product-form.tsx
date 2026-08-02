'use client';

import { useEffect, useState } from "react";
import { useForm } from "@tanstack/react-form";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import type { MentorshipType } from "@/lib/queries/api-client";
import { useProductMutations } from "./hooks/use-product-mutations";
import { BasicInfoSection } from "./sections/BasicInfoSection";
import { PricingSection } from "./sections/PricingSection";
import { ProductTypeSection } from "./sections/ProductTypeSection";
import { SessionPackSection } from "./sections/SessionPackSection";
import { SchedulingSection } from "./sections/SchedulingSection";
import { StripeImportSection } from "./sections/StripeImportSection";
import { ResultCard } from "./ResultCard";
import type { ProductFormProps, ProductData, ProductUpdateResult } from "./types";

export function ProductForm({
  mode,
  initialData,
  productId,
  instructors,
  isLoadingInstructors,
}: ProductFormProps) {
  const [activeTab, setActiveTab] = useState(mode === "create" ? "create-new" : "edit");
  const [result, setResult] = useState<ProductUpdateResult | null>(null);

  const {
    createProductMutation,
    updateProductMutation,
    importFromStripeMutation,
    handleCreateSubmit,
    handleUpdateSubmit,
    handleImportSubmit,
  } = useProductMutations({ productId, setResult });

  const form = useForm({
    defaultValues: {
      instructorId: initialData?.instructorId || "",
      title: initialData?.title || "",
      description: initialData?.description || "",
      imageUrl: initialData?.imageUrl || "",
      price: initialData?.price || "",
      currency: initialData?.currency || "usd",
      sessionsPerPack: initialData?.sessionsPerPack || 4,
      validityDays: initialData?.validityDays || 30,
      mentorshipType: initialData?.mentorshipType || ("one-on-one" as MentorshipType),
      enableStripe: initialData?.enableStripe ?? true,
      enablePayPal: initialData?.enablePayPal ?? true,
    },
    onSubmit: async ({ value }) => {
      // Normalize price to a canonical decimal string (supports comma input)
      const priceStr = String(value.price ?? "").trim().replace(",", ".");
      const priceNum = Number(priceStr);
      const normalizedPrice = Number.isFinite(priceNum) && priceNum > 0 ? priceNum.toFixed(2) : priceStr;

      const submitData: ProductData = {
        instructorId: value.instructorId,
        title: (value.title || "").trim(),
        description: value.description || undefined,
        imageUrl: value.imageUrl || undefined,
        price: normalizedPrice,
        currency: value.currency,
        sessionsPerPack: value.sessionsPerPack,
        validityDays: value.validityDays,
        mentorshipType: value.mentorshipType,
        enableStripe: value.enableStripe,
        enablePayPal: value.enablePayPal,
      };

      if (mode === "create") {
        handleCreateSubmit(submitData);
      } else {
        handleUpdateSubmit(submitData);
      }
    },
    validators: {
      // Keep form-level free; we handle cross-field provider error inline below
    },
  });

  // UX: If instructors have loaded and none selected yet, auto-select the first one.
  useEffect(() => {
    if (!isLoadingInstructors && instructors.length > 0) {
      if (!form.state.values.instructorId) {
        form.setFieldValue("instructorId", instructors[0].id);
      }
    }
  }, [isLoadingInstructors, instructors, form]);

  const isSubmitting = mode === "create" ? createProductMutation.isPending : updateProductMutation.isPending;

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">
              {mode === "create" ? "Create Product" : "Edit Product"}
            </h1>
            <p className="text-muted-foreground mt-1">
              {mode === "create"
                ? "Create a new session pack or import from Stripe"
                : "Update the product details below"}
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/admin/products">View Products</Link>
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="create-new">
              {mode === "create" ? "Create New Product" : "Edit Product"}
            </TabsTrigger>
            <TabsTrigger value="import-stripe">Import from Stripe</TabsTrigger>
          </TabsList>

          <TabsContent value="create-new">
            <Card>
              <CardHeader>
                <CardTitle>{mode === "create" ? "Create New Product" : "Edit Product"}</CardTitle>
                <CardDescription>
                  {mode === "create"
                    ? "Create a new session pack with full customization"
                    : "Update the product details below"}
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
                  <BasicInfoSection
                    form={form}
                    instructors={instructors}
                    isLoadingInstructors={isLoadingInstructors}
                    isSubmitting={isSubmitting}
                  />
                  <ProductTypeSection form={form} />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <PricingSection form={form} isSubmitting={isSubmitting} />
                    <SessionPackSection form={form} isSubmitting={isSubmitting} />
                  </div>
                  <SchedulingSection form={form} isSubmitting={isSubmitting} />
                  <div className="flex gap-3 pt-4">
                    <form.Subscribe
                      selector={(state) => ({
                        instructorId: state.values.instructorId,
                        title: state.values.title,
                        price: state.values.price,
                        enableStripe: state.values.enableStripe,
                        enablePayPal: state.values.enablePayPal,
                      })}
                    >
                      {(s) => {
                        const missing: string[] = [];
                        const priceStr = String(s.price ?? "").trim().replace(",", ".");
                        const priceNum = Number(priceStr);
                        const trimmedTitle = (s.title || "").trim();

                        const isDisabled =
                          isSubmitting ||
                          isLoadingInstructors ||
                          !s.instructorId ||
                          !trimmedTitle ||
                          !priceStr ||
                          Number.isNaN(priceNum) || priceNum <= 0 ||
                          !(s.enableStripe || s.enablePayPal);

                        if (!s.instructorId) missing.push("Instructor");
                        if (!trimmedTitle) missing.push("Title");
                        if (!priceStr || Number.isNaN(priceNum) || priceNum <= 0) missing.push("Valid price");
                        if (!(s.enableStripe || s.enablePayPal)) missing.push("At least one provider");

                        return (
                          <div className="flex flex-col gap-2">
                            <Button type="submit" disabled={isDisabled}>
                              {isSubmitting ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  {mode === "create" ? "Creating..." : "Saving..."}
                                </>
                              ) : mode === "create" ? (
                                "Create Product"
                              ) : (
                                "Save Changes"
                              )}
                            </Button>
                            {isDisabled && !isSubmitting && (
                              <p className="text-xs text-muted-foreground">
                                To enable: {missing.length > 0 ? missing.join(", ") : "check required fields"}.
                              </p>
                            )}
                          </div>
                        );
                      }}
                    </form.Subscribe>
                  </div>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="import-stripe">
            <StripeImportSection
              instructors={instructors}
              isLoadingInstructors={isLoadingInstructors}
              isSubmitting={importFromStripeMutation.isPending}
              onSubmit={handleImportSubmit}
            />
          </TabsContent>
        </Tabs>

        <ResultCard result={result} mode={mode} onDismiss={() => setResult(null)} />
      </div>
    </div>
  );
}
