import { defineConfig } from "vitest/config";

/**
 * Vitest config for Convex functions.
 *
 * Run tests with:
 *   pnpm test:convex            # Run all convex tests once
 *   pnpm test:convex --watch    # Watch mode
 *
 * Uses `environment: "edge-runtime"` per Convex guidelines
 * (see `convex/_generated/ai/guidelines.md`). Separate from the
 * root `vitest.config.mjs` (jsdom-based for app code) so the two
 * test environments don't conflict.
 *
 * The `include` glob is anchored to `convex/` so it doesn't pick
 * up the app-side tests that use jsdom.
 */
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
  },
});
