import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { processStripeCheckout, processStripeRefund, processPayPalCheckout, processPayPalRefund } from "@/inngest/functions/payments";
import { handleNotificationSend } from "@/inngest/functions/notifications";
import { processDiscordActionQueue } from "@/inngest/functions/discord";
import {
  handleSessionCompleted,
  checkSeatExpiration,
  handleRenewalReminder,
  sendGracePeriodFinalWarning,
} from "@/inngest/functions/sessions";
import { onboardingFlow } from "@/inngest/functions/onboarding";
import { linkClerkUserToInstructor } from "@/inngest/functions/clerk-user-linking";
import { unlinkClerkUserFromInstructor } from "@/inngest/functions/clerk-user-deleted";
import { syncInstructorInventoryToConvex } from "@/inngest/functions/inventory-sync";
import {
  syncPaymentCreated,
  syncPaymentUpdated,
  syncOrderCreated,
  syncOrderUpdated,
  syncSessionPackCreated,
  syncSessionPackUpdated,
  syncSeatReservationCreated,
  syncSeatReservationUpdated,
} from "@/inngest/functions/sync";

// SYNC HANDLERS DISABLED - Using Convex-only architecture for simplified payment flow
// Re-enable after MVP demo if SQL analytics replica is needed
// import {
//   syncPaymentCreated,
//   syncPaymentUpdated,
//   syncOrderCreated,
//   syncOrderUpdated,
//   syncSessionPackCreated,
//   syncSessionPackUpdated,
//   syncSeatReservationCreated,
//   syncSeatReservationUpdated,
// } from "@/inngest/functions/sync";

// Export all functions for Inngest to serve
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    // Payment processing - Core Stripe/PayPal flow
    processStripeCheckout,
    processStripeRefund,
    processPayPalCheckout,
    processPayPalRefund,
    // Onboarding - triggered after successful purchase
    onboardingFlow,
    // Session management
    handleSessionCompleted,
    checkSeatExpiration,
    handleRenewalReminder,
    sendGracePeriodFinalWarning,
    // Notifications
    handleNotificationSend,
    // Discord automation
    processDiscordActionQueue,
    // Clerk user management
    linkClerkUserToInstructor,
    unlinkClerkUserFromInstructor,
    // Inventory sync from Stripe products
    syncInstructorInventoryToConvex,
    // SQL SYNC DISABLED - Convex is source of truth for all payment data
    // syncPaymentCreated,
    // syncPaymentUpdated,
    // syncOrderCreated,
    // syncOrderUpdated,
    // syncSessionPackCreated,
    // syncSessionPackUpdated,
    // syncSeatReservationCreated,
    // syncSeatReservationUpdated,
  ],
});

