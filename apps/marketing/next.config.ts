import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: false,
  redirects: async () => {
    return [
      { source: "/sign-in", destination: "/", permanent: true },
      { source: "/sign-up", destination: "/", permanent: true },

      { source: "/dashboard/:path*", destination: "/", permanent: true },
      { source: "/calendar/:path*", destination: "/", permanent: true },
      { source: "/sessions/:path*", destination: "/", permanent: true },
      { source: "/settings/:path*", destination: "/", permanent: true },
      { source: "/onboarding/:path*", destination: "/", permanent: true },

      { source: "/instructor/:path*", destination: "/instructors", permanent: true },
      { source: "/checkout/:path*", destination: "/", permanent: true },
      { source: "/waitlist/:path*", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;
