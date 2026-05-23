import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  
  // Transpile packages from the monorepo
  transpilePackages: ["@mentorships/payments", "@mentorships/ui"],

  // Allow Next.js Image Optimization for Convex Storage URLs
  // Context7 docs: use images.remotePatterns with wildcard subdomains
  images: {
    // Be explicit for Vercel builds that may not match wildcard correctly
    domains: ["fine-bulldog-260.convex.cloud"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.convex.cloud",
        port: "",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
