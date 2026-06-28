import type { AuthConfig } from "convex/server";

function parseClerkIssuerDomains(value: string | undefined): string[] {
  return value?.split(",").map((domain) => domain.trim()).filter(Boolean) ?? [];
}

const clerkIssuerDomains =
  parseClerkIssuerDomains(process.env.CLERK_JWT_ISSUER_DOMAINS).length > 0
    ? parseClerkIssuerDomains(process.env.CLERK_JWT_ISSUER_DOMAINS)
    : parseClerkIssuerDomains(process.env.CLERK_JWT_ISSUER_DOMAIN).length > 0
      ? parseClerkIssuerDomains(process.env.CLERK_JWT_ISSUER_DOMAIN)
      : ["https://clerk.mentorships.huckleberry.art"];

export default {
  providers: clerkIssuerDomains.map((domain) => ({
    domain,
    applicationID: "convex",
  })),
} satisfies AuthConfig;
