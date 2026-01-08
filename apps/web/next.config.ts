import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  
  // Transpile packages from the monorepo
  transpilePackages: ["@mentorships/db", "@mentorships/payments", "@mentorships/ui"],
};

export default nextConfig;

