import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      domain: "https://clerk.mentorships.huckleberry.art",
      applicationID: "convex",
    },
    {
      domain: "https://epic-rhino-31.clerk.accounts.dev",
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
