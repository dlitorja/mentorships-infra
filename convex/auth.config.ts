import type { AuthConfig } from "convex/server";

function parseClerkIssuerDomains(value: string | undefined): string[] {
  return value?.split(",").map((domain) => domain.trim()).filter(Boolean) ?? [];
}

const pluralIssuerDomains = parseClerkIssuerDomains(process.env.CLERK_JWT_ISSUER_DOMAINS);
const singularIssuerDomain = parseClerkIssuerDomains(process.env.CLERK_JWT_ISSUER_DOMAIN);

// Fallback Clerk issuer domains when neither `CLERK_JWT_ISSUER_DOMAINS`
// nor `CLERK_JWT_ISSUER_DOMAIN` is set on the Convex deployment. The
// `dev.` subdomain is the Vercel preview deployment
// (`dev.mentorships.huckleberry.art`) — without it, preview deployments
// would 401 because the preview Clerk instance issues JWTs from a
// different Frontend API URL than the production instance. Add new
// subdomains here when a new preview environment is provisioned; the
// long-term fix is to set `CLERK_JWT_ISSUER_DOMAINS` on the Convex
// deployment for every environment (comma-separated list).
const fallbackIssuerDomains = [
  "https://clerk.mentorships.huckleberry.art",
  "https://clerk.dev.mentorships.huckleberry.art",
];

const clerkIssuerDomains =
  pluralIssuerDomains.length > 0
    ? pluralIssuerDomains
    : singularIssuerDomain.length > 0
      ? singularIssuerDomain
      : fallbackIssuerDomains;

export default {
  providers: clerkIssuerDomains.map((domain) => ({
    domain,
    applicationID: "convex",
  })),
} satisfies AuthConfig;
