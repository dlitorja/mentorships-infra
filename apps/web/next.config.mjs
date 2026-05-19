/** @type {import('next').NextConfig} */
const isPreview = process.env.VERCEL_ENV === 'preview';

const nextConfig = {
  // Keep production builds full-fidelity; lighten preview builds to reduce memory pressure
  productionBrowserSourceMaps: !isPreview,
  experimental: {
    // Helps isolate heavy work and can reduce main process memory spikes
    webpackBuildWorker: true,
  },
};

export default nextConfig;
