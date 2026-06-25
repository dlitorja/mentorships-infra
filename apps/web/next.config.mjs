/** @type {import('next').NextConfig} */
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isPreview = process.env.VERCEL_ENV === 'preview';

const nextConfig = {
  // Keep production builds full-fidelity; lighten preview builds to reduce memory pressure
  productionBrowserSourceMaps: !isPreview,

  // Fix monorepo workspace root for Turbopack - must match where next/package.json lives
  turbopack: {
    root: resolve(__dirname),
  },
};

export default nextConfig;
