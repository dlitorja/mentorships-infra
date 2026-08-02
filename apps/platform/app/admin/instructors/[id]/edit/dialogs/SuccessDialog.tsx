'use client';

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface SuccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  successMessage: string;
  deactivationResults: {
    stripeSuccess: string[];
    stripeFailed: { id: string; error: string }[];
  } | null;
}

export function SuccessDialog({
  open,
  onOpenChange,
  successMessage,
  deactivationResults,
}: SuccessDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {deactivationResults?.stripeFailed && deactivationResults.stripeFailed.length > 0 ? "Partial Success" : "Success"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm">{successMessage}</p>

          {deactivationResults && (
            <div className="space-y-2">
              {deactivationResults.stripeSuccess.length > 0 && (
                <div className="text-sm text-green-600">
                  <p className="font-medium">Successfully deactivated on Stripe:</p>
                  <ul className="list-disc pl-4 mt-1">
                    {deactivationResults.stripeSuccess.map((id, i) => (
                      <li key={i} className="text-xs">{id}</li>
                    ))}
                  </ul>
                </div>
              )}

              {deactivationResults.stripeFailed.length > 0 && (
                <div className="text-sm text-red-600">
                  <p className="font-medium">Failed to deactivate on Stripe:</p>
                  <ul className="list-disc pl-4 mt-1">
                    {deactivationResults.stripeFailed.map((item, i) => (
                      <li key={i} className="text-xs">
                        {item.id}: {item.error}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs">
                    You can try again manually or deactivate these products directly in the Stripe dashboard.
                  </p>
                  <Button
                    variant="link"
                    className="h-auto p-0 text-blue-600"
                    asChild
                  >
                    <a
                      href="https://dashboard.stripe.com/products"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open Stripe Dashboard
                    </a>
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
