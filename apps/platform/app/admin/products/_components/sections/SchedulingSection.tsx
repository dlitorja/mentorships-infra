'use client';

import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { CreditCard, Wallet } from "lucide-react";

interface SchedulingSectionProps {
  form: any;
  isSubmitting: boolean;
}

export function SchedulingSection({ form, isSubmitting }: SchedulingSectionProps) {
  return (
    <div className="border-t pt-6">
      <h3 className="font-semibold mb-2">Payment Providers <span className="text-red-600">(at least one required)</span></h3>
      <div className="flex flex-col gap-3">
        <form.Field name="enableStripe">
          {(field: any) => {
            const id = "enable-stripe";
            return (
              <div className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50">
                <Checkbox
                  id={id}
                  aria-describedby={`${id}-description`}
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked === true)}
                  disabled={isSubmitting}
                />
                <CreditCard className="h-5 w-5 text-purple-600" aria-hidden="true" />
                <div className="flex-1">
                  <Label htmlFor={id} className="font-medium cursor-pointer">
                    Enable Stripe
                  </Label>
                  <p id={`${id}-description`} className="text-sm text-muted-foreground">
                    Create product in Stripe automatically
                  </p>
                </div>
              </div>
            );
          }}
        </form.Field>

        <form.Field name="enablePayPal">
          {(field: any) => {
            const id = "enable-paypal";
            return (
              <div className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50">
                <Checkbox
                  id={id}
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked === true)}
                  disabled={isSubmitting}
                />
                <Wallet className="h-5 w-5 text-blue-600" aria-hidden="true" />
                <div className="flex-1">
                  <Label htmlFor={id} className="font-medium cursor-pointer">
                    Enable PayPal
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Create product in PayPal automatically
                  </p>
                </div>
              </div>
            );
          }}
        </form.Field>
      </div>
      {!(form.state.values.enableStripe || form.state.values.enablePayPal) && (
        <p className="mt-2 text-sm text-red-600">Select at least one provider (Stripe or PayPal).</p>
      )}
    </div>
  );
}
