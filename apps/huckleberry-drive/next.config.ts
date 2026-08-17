import type { NextConfig } from "next";

if (
  process.env.VERCEL === "1" &&
  process.env.VERCEL_ENV === "production" &&
  !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
) {
  throw new Error(
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY is required for the Huckleberry Drive production deployment. " +
      "Add it to the Vercel project environment variables and redeploy."
  );
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
