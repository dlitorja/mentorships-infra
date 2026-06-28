import type { AuthConfig } from "convex/server";

const clerkIssuerDomains = (
  process.env.CLERK_JWT_ISSUER_DOMAINS ||
  process.env.CLERK_JWT_ISSUER_DOMAIN ||
  "https://clerk.mentorships.huckleberry.art"
)
  .split(",")
  .map((domain) => domain.trim())
  .filter(Boolean);

export default {
  providers: clerkIssuerDomains.map((domain) => ({
    domain,
    applicationID: "convex",
  })),
} satisfies AuthConfig;
