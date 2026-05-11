import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import {
  processStripeCheckout,
  processStripeRefund,
  processPayPalCheckout,
  processPayPalRefund,
} from "@/inngest/functions/payments";
import { onboardingFlow } from "@/inngest/functions/onboarding";
import { syncInstructorInventoryToConvex } from "@/inngest/functions/inventory-sync";

// Export all functions for Inngest to serve
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    // Payment processing - Core Stripe/PayPal flow (Convex-based)
    processStripeCheckout,
    processStripeRefund,
    processPayPalCheckout,
    processPayPalRefund,
    // Onboarding - triggered after successful purchase (Convex-based)
    onboardingFlow,
    // Inventory sync from Stripe products to Convex (Convex HTTP endpoint)
    syncInstructorInventoryToConvex,
  ],
});