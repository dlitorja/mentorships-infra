import { afterEach, describe, expect, it } from "vitest";
import {
  getConvexCloudUrl,
  getConvexSiteUrl,
} from "../../src/trigger/lib/convex-urls";

const ENV_KEYS = [
  "CONVEX_SITE_URL",
  "CONVEX_CLOUD_URL",
  "NEXT_PUBLIC_CONVEX_URL",
  "CONVEX_DEPLOYMENT_URL",
] as const;

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(clearEnv);

describe("getConvexSiteUrl", () => {
  it("derives the HTTP-actions host from NEXT_PUBLIC_CONVEX_URL", () => {
    // This is the bug that broke notify-recording-ready: using the
    // `.convex.cloud` host for an HTTP route returns 404.
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://fine-bulldog-260.convex.cloud";
    expect(getConvexSiteUrl()).toBe("https://fine-bulldog-260.convex.site");
  });

  it("prefers an explicit CONVEX_SITE_URL and strips trailing slashes", () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://fine-bulldog-260.convex.cloud";
    process.env.CONVEX_SITE_URL = "https://fine-bulldog-260.convex.site/";
    expect(getConvexSiteUrl()).toBe("https://fine-bulldog-260.convex.site");
  });

  it("is idempotent when the input is already a site URL", () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://fine-bulldog-260.convex.site";
    expect(getConvexSiteUrl()).toBe("https://fine-bulldog-260.convex.site");
  });

  it("falls back to CONVEX_DEPLOYMENT_URL", () => {
    process.env.CONVEX_DEPLOYMENT_URL = "https://other-otter-123.convex.cloud";
    expect(getConvexSiteUrl()).toBe("https://other-otter-123.convex.site");
  });

  it("returns null when nothing is configured", () => {
    expect(getConvexSiteUrl()).toBeNull();
    expect(getConvexCloudUrl()).toBeNull();
  });
});

describe("getConvexCloudUrl", () => {
  it("keeps the query host for ConvexHttpClient", () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://fine-bulldog-260.convex.cloud";
    expect(getConvexCloudUrl()).toBe("https://fine-bulldog-260.convex.cloud");
  });

  it("converts a site URL back to the cloud host", () => {
    process.env.CONVEX_SITE_URL = "https://fine-bulldog-260.convex.site";
    // CONVEX_SITE_URL is only read by getConvexSiteUrl, so set the shared var.
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://fine-bulldog-260.convex.site/";
    expect(getConvexCloudUrl()).toBe("https://fine-bulldog-260.convex.cloud");
  });
});
