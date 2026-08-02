'use client';

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface PricingSectionProps {
  form: any;
  isSubmitting: boolean;
}

export function PricingSection({ form, isSubmitting }: PricingSectionProps) {
  return (
    <form.Field name="price">
      {(field: any) => (
        <div className="space-y-2">
          <Label htmlFor={field.name}>Price (USD) *</Label>
          <Input
            id={field.name}
            type="number"
            step="0.01"
            min="0"
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            onBlur={field.handleBlur}
            placeholder="199.00"
            disabled={isSubmitting}
          />
          {field.state.meta.isTouched && (() => {
            const v = field.state.value;
            const num = parseFloat(String(v));
            if (!v || v.toString().trim().length === 0) {
              return <p className="text-sm text-red-600">Price is required.</p>;
            }
            if (Number.isNaN(num) || num <= 0) {
              return <p className="text-sm text-red-600">Enter a positive price.</p>;
            }
            return null;
          })()}
        </div>
      )}
    </form.Field>
  );
}
