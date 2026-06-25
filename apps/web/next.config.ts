import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  
  // Transpile packages from the monorepo
  transpilePackages: ["@mentorships/db", "@mentorships/payments", "@mentorships/ui"],

  // Fix monorepo workspace root for Turbopack
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;

