import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN || "https://clerk.mentorships.huckleberry.art",
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;