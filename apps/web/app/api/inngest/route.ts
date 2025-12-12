import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { processStripeCheckout, processStripeRefund } from "@/inngest/functions/payments";
import { handleNotificationSend } from "@/inngest/functions/notifications";
import {
  handleSessionCompleted,
  checkSeatExpiration,
  handleRenewalReminder,
  sendGracePeriodFinalWarning,
} from "@/inngest/functions/sessions";
import { onboardingFlow } from "@/inngest/functions/onboarding";

// Export all functions for Inngest to serve
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processStripeCheckout,
    processStripeRefund,
    onboardingFlow,
    handleSessionCompleted,
    checkSeatExpiration,
    handleRenewalReminder,
    sendGracePeriodFinalWarning,
    handleNotificationSend,
  ],
});

