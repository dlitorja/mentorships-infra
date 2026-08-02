'use client';

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface SessionPackSectionProps {
  form: any;
  isSubmitting: boolean;
}

export function SessionPackSection({ form, isSubmitting }: SessionPackSectionProps) {
  return (
    <>
      <form.Field name="sessionsPerPack">
        {(field: any) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Sessions per Pack *</Label>
            <Input
              id={field.name}
              type="number"
              min="1"
              max="100"
              value={field.state.value}
              onChange={(e) => field.handleChange(parseInt(e.target.value) || 1)}
              onBlur={field.handleBlur}
              disabled={isSubmitting}
            />
            {field.state.meta.isTouched && (() => {
              const v = Number(field.state.value);
              if (!Number.isInteger(v) || v < 1 || v > 100) {
                return <p className="text-sm text-red-600">Must be between 1 and 100.</p>;
              }
              return null;
            })()}
          </div>
        )}
      </form.Field>

      <form.Field name="validityDays">
        {(field: any) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Validity (days) *</Label>
            <Input
              id={field.name}
              type="number"
              min="1"
              max="365"
              value={field.state.value}
              onChange={(e) => field.handleChange(parseInt(e.target.value) || 30)}
              onBlur={field.handleBlur}
              disabled={isSubmitting}
            />
            {field.state.meta.isTouched && (() => {
              const v = Number(field.state.value);
              if (!Number.isInteger(v) || v < 1 || v > 365) {
                return <p className="text-sm text-red-600">Must be between 1 and 365.</p>;
              }
              return null;
            })()}
          </div>
        )}
      </form.Field>
    </>
  );
}
