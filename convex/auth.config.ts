import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN || "clerk.clerk.com",
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
