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

// Export all functions for Inngest to serve
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processStripeCheckout,
    processStripeRefund,
    processPayPalCheckout,
    processPayPalRefund,
    onboardingFlow,
    handleSessionCompleted,
    checkSeatExpiration,
    handleRenewalReminder,
    sendGracePeriodFinalWarning,
    handleNotificationSend,
    processDiscordActionQueue,
    linkClerkUserToInstructor,
    unlinkClerkUserFromInstructor,
    syncInstructorInventoryToConvex,
  ],
});

