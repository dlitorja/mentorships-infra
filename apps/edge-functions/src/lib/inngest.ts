import { Inngest } from "inngest";
import type { Env } from "./env";

export function createInngestClient(env: Env) {
  return new Inngest({
    id: env.INNGEST_APP_ID || "mentorships-platform",
    eventKey: env.INNGEST_EVENT_KEY,
  });
}
