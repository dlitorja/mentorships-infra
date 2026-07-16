import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import {
  processStripeCheckout,
  processStripeRefund,
  processPayPalCheckout,
  processPayPalRefund,
} from "@/inngest/functions/payments";
import { onboardingFlow, adminOnboardingFlow } from "@/inngest/functions/onboarding";
import { syncInstructorInventoryToConvex } from "@/inngest/functions/inventory-sync";
import { linkClerkUserToSessionPacks } from "@/inngest/functions/clerk-user-linking";
import { handleClerkUserCreated, handleClerkUserUpdated } from "@/inngest/functions/clerk-user-instructor-lifecycle";
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
    // Admin onboarding - PR 2 stub; replaced by PR 3 with real Resend + Discord
    adminOnboardingFlow,
    // Inventory sync from Stripe products to Convex (Convex HTTP endpoint)
    syncInstructorInventoryToConvex,
    // Clerk user linking - links guest purchases to Clerk user after signup
    linkClerkUserToSessionPacks,
    // Clerk instructor lifecycle - creates/deactivates instructor records based on Clerk role
    handleClerkUserCreated,
    handleClerkUserUpdated,
    // Migration - one-time migration of existing guest session packs
    migrateGuestSessionPacks,
  ],
});