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
import { linkClerkUserToSessionPacks } from "@/inngest/functions/clerk-user-linking";
import { migrateGuestSessionPacks } from "@/inngest/functions/migrate-guest-session-packs";

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
    // Clerk user linking - links guest purchases to Clerk user after signup
    linkClerkUserToSessionPacks,
    // Migration - one-time migration of existing guest session packs
    migrateGuestSessionPacks,
  ],
});