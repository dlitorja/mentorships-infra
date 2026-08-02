'use client';

import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import type { ImportFromStripeFormProps } from "../types";

export function StripeImportSection({
  instructors,
  isLoadingInstructors,
  isSubmitting,
  onSubmit,
}: ImportFromStripeFormProps) {
  const form = useForm({
    defaultValues: {
      productId: "",
      priceId: "",
      instructorId: "__unassigned__",
    },
    onSubmit: async ({ value }) => {
      onSubmit({
        productId: value.productId.trim() || undefined,
        priceId: value.priceId.trim() || undefined,
        instructorId: value.instructorId === "__unassigned__" ? undefined : value.instructorId || undefined,
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
          <form.Field name="instructorId">
            {(field: any) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Assign to Instructor (optional)</Label>
                <Select
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  disabled={isLoadingInstructors}
                >
                  <SelectTrigger id={field.name}>
                    <SelectValue placeholder="Select an instructor (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">No instructor assigned</SelectItem>
                    {instructors.map((instructor) => (
                      <SelectItem key={instructor.id} value={instructor.id}>
                        {instructor.name || instructor.email || instructor.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>

          <form.Field name="productId">
            {(field: any) => (
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
            {(field: any) => (
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

          <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
            <p className="text-sm text-blue-900 dark:text-blue-100">
              <strong>Note:</strong> Use the &quot;Create New Product&quot; tab to enable PayPal checkout. 
              The Import from Stripe feature only creates Stripe-based products.
            </p>
          </div>

          <div className="flex gap-3">
            <Button
              type="submit"
              disabled={
                isSubmitting ||
                isLoadingInstructors ||
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
              <li>Find your product (e.g., &quot;Ash Kirk 1-on-1 Session&quot;)</li>
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
