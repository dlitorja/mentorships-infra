import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: process.env.INNGEST_APP_ID || "mentorships-platform",
  eventKey: process.env.INNGEST_EVENT_KEY,
});

