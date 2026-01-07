import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { processWaitlistNotifications } from "@/inngest/functions/waitlist-notifications";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processWaitlistNotifications],
});
