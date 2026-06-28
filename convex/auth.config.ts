import type { AuthConfig } from "convex/server";

function parseClerkIssuerDomains(value: string | undefined): string[] {
  return value?.split(",").map((domain) => domain.trim()).filter(Boolean) ?? [];
}

const pluralIssuerDomains = parseClerkIssuerDomains(process.env.CLERK_JWT_ISSUER_DOMAINS);
const singularIssuerDomain = parseClerkIssuerDomains(process.env.CLERK_JWT_ISSUER_DOMAIN);

const clerkIssuerDomains =
  pluralIssuerDomains.length > 0
    ? pluralIssuerDomains
    : singularIssuerDomain.length > 0
      ? singularIssuerDomain
      : ["https://clerk.mentorships.huckleberry.art"];

export default {
  providers: clerkIssuerDomains.map((domain) => ({
    domain,
    applicationID: "convex",
  })),
} satisfies AuthConfig;
