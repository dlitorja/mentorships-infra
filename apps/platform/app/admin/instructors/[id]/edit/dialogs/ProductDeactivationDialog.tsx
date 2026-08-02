'use client';

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import type { ActiveProduct } from "../types";

interface ProductDeactivationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeProducts: ActiveProduct[];
  onDeactivate: () => void;
  isPending: boolean;
}

export function ProductDeactivationDialog({
  open,
  onOpenChange,
  activeProducts,
  onDeactivate,
  isPending,
}: ProductDeactivationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Deactivate Products</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This instructor has {activeProducts.length} active product(s) on Stripe.
            To deactivate this instructor, we will also deactivate these products on Stripe.
          </p>
          <div className="max-h-40 overflow-y-auto border rounded p-2">
            {activeProducts.map((product) => (
              <div key={product.id} className="text-sm py-1">
                <span className="font-medium">{product.title}</span>
                {product.stripeProductId && (
                  <span className="text-muted-foreground ml-2">
                    (ID: {product.stripeProductId})
                  </span>
                )}
              </div>
            ))}
          </div>
          <p className="text-sm text-amber-600">
            Note: Products will be set to inactive on Stripe. You can manually reactivate them later if needed.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onDeactivate}
            disabled={isPending}
            className="bg-amber-600 hover:bg-amber-700"
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Deactivate Both
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
