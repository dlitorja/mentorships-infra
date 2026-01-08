import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { processWaitlistNotifications } from "@/inngest/functions/waitlist-notifications";
import { handleInventoryChanged } from "@/inngest/functions/inventory-changed";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processWaitlistNotifications, handleInventoryChanged],
});
