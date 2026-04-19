import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN || process.env.CLERK_FRONTEND_API_URL || process.env.CONVEX_SITE_URL || "https://clerk.mentorships.huckleberry.art",
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
