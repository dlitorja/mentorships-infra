import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { processStripeCheckout, processStripeRefund } from "@/inngest/functions/payments";
// import { handleSessionCompleted } from "@/inngest/functions/session-reminders";
// import { checkPackExpiration, handlePackExpirationCheck } from "@/inngest/functions/pack-expiration";
// import { onboardingFlow } from "@/inngest/functions/onboarding";

// Export all functions for Inngest to serve
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processStripeCheckout,
    processStripeRefund,
    // Functions will be added here as we implement them
  ],
});

