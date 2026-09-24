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
  },
});
convex.use(migrations);
convex.use(rateLimiter);

export default convex;
