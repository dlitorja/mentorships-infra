import { defineApp } from "convex/server";
import { v } from "convex/values";
import migrations from "@convex-dev/migrations/convex.config.js";

const convex = defineApp({
  env: {
    EMAIL_FROM_TRANSACTIONAL: v.optional(v.string()),
    EMAIL_FROM_MARKETING: v.optional(v.string()),
    EMAIL_FROM_STAGING: v.optional(v.string()),
    RESEND_WEBHOOK_SECRET: v.optional(v.string()),
    RESEND_API_KEY: v.optional(v.string()),
  },
});
convex.use(migrations);

export default convex;
