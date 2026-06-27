import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN || "https://epic-rhino-31.clerk.accounts.dev",
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;