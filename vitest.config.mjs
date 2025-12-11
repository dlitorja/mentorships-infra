import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vitest Unit Test Configuration
 * 
 * Run tests:
 *   pnpm test:unit           # Run all unit tests
 *   pnpm test:unit:ui        # Run with UI
 *   pnpm test:unit --watch   # Watch mode
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: [path.resolve(__dirname, "./tests/unit/setup.ts")],
    include: [
      // Only include test files in source directories, not node_modules
      "apps/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      "packages/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      "tests/unit/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
    ],
    exclude: [
      // Build outputs
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      // E2E tests (run separately with Playwright)
      "**/tests/e2e/**",
      "**/e2e/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "tests/",
        "**/*.config.*",
        "**/*.d.ts",
        "**/types.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./apps/web"),
      "@mentorships/db": path.resolve(__dirname, "./packages/db/src"),
      "@mentorships/payments": path.resolve(__dirname, "./packages/payments/src"),
    },
  },
});

