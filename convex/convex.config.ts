import { defineApp } from "convex/server";
import { v } from "convex/values";
import migrations from "@convex-dev/migrations/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";

const convex = defineApp({
  env: {
    EMAIL_FROM_TRANSACTIONAL: v.optional(v.string()),
    EMAIL_FROM_MARKETING: v.optional(v.string()),
    EMAIL_FROM_STAGING: v.optional(v.string()),
    RESEND_WEBHOOK_SECRET: v.optional(v.string()),
    RESEND_API_KEY: v.optional(v.string()),
    TURNSTILE_SECRET_KEY: v.optional(v.string()),
    TURNSTILE_ALLOWED_HOSTNAMES: v.optional(v.string()),
    // PR workspace-storage-1 (widen): name of the Backblaze B2
    // bucket that workspace uploads (images, chat files, note
    // attachments) flow into. Kept distinct from `B2_BUCKET_NAME`
    // (the instructor-uploads bucket) so workspace retention cannot
    // accidentally delete instructor-uploaded recordings.
    WORKSPACE_STORAGE_BUCKET_NAME: v.optional(v.string()),
    // HUC-95: Inngest public-ingest event key, used by
    // `convex/onboardingQuestionnaireActions.ts:notifyInstructorOnSubmission`
    // to POST `questionnaire/submitted` events to `inn.gs`.
    // The same key is also configured in
    // `apps/platform/inngest/client.ts` for the Next.js-side
    // SDK calls. We declare it here for documentation and
    // audit-ability — the action still reads via
    // `process.env.INNGEST_EVENT_KEY` so tests can mock it
    // without depending on the typed `ctx.env` API which is
    // not yet surfaced by `convex-test@0.0.55`. The deploy
    // script syncs the value here AND in the Next.js
    // `.env*` files; a missing value is treated as "skip the
    // send" rather than a hard fail so a misconfigured env
    // doesn't break the questionnaire-submit path.
    INNGEST_EVENT_KEY: v.optional(v.string()),
  },
});
convex.use(migrations);
convex.use(rateLimiter);

export default convex;
