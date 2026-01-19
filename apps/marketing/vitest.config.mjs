import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: [path.resolve(__dirname, "../../tests/unit/setup.ts")],
    include: [
      "apps/marketing/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/tests/e2e/**",
      "**/e2e/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./apps/marketing/"),
      "^@mentorships/marketing/(.*)$": path.resolve(__dirname, "./apps/marketing/$1"),
      "@mentorships/db": path.resolve(__dirname, "./packages/db/src"),
      "@mentorships/payments": path.resolve(__dirname, "./packages/payments/src"),
    },
  },
});
