import type { NextConfig } from "next";

if (process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
  throw new Error(
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY is required in production. " +
      "Add it to your Vercel project environment variables and redeploy."
  );
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
