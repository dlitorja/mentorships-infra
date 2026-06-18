import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN || process.env.CLERK_FRONTEND_API_URL || "https://clerk.mentorships.huckleberry.art",
      applicationID: "convex",
    },
    {
      domain: "https://epic-rhino-31.clerk.accounts.dev",
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
