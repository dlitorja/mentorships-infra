import type { NextConfig } from "next";
import path from "path";

const isPreview = process.env.VERCEL_ENV === "preview";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Keep production builds full-fidelity; lighten preview builds to reduce memory pressure
  productionBrowserSourceMaps: !isPreview,

  // Transpile packages from the monorepo
  transpilePackages: ["@mentorships/db", "@mentorships/payments", "@mentorships/ui"],

  // Fix monorepo workspace root for Turbopack
  experimental: {
    // @ts-ignore - turbopack.root is valid in Next.js 16 but missing from TypeScript types
    turbopack: {
      root: path.resolve(__dirname),
    },
  },
};

export default nextConfig;

