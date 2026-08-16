import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mts", ".mjs", ".cjs"];

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function resolveAppFile(appDir, source) {
  const relativePath = source.startsWith("@/") ? source.slice(2) : source;
  const base = path.resolve(__dirname, appDir, relativePath);

  if (isFile(base)) {
    return base;
  }

  for (const ext of SOURCE_EXTENSIONS) {
    const candidate = base + ext;
    if (isFile(candidate)) {
      return candidate;
    }
  }

  if (isDirectory(base)) {
    for (const ext of SOURCE_EXTENSIONS) {
      const candidate = path.join(base, "index" + ext);
      if (isFile(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Resolve `@/` imports to the app that owns the importer.
 * `apps/platform` and `apps/web` both use `@/` as their Next.js alias, but
 * they resolve to different directories. The static Vite alias only supports
 * one target, so we use a plugin that inspects the importer path.
 */
function appAliasResolver() {
  return {
    name: "app-alias-resolver",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer) {
        return null;
      }

      // Shared test utilities use a bare `tests/unit/*` import
      if (source.startsWith("tests/unit/")) {
        return path.resolve(__dirname, source);
      }

      if (!source.startsWith("@/")) {
        return null;
      }

      // Shared Convex generated files are mapped via a dedicated path alias
      // in each app's tsconfig.json (e.g., `@/convex/_generated/api`).
      if (source.startsWith("@/convex/_generated/")) {
        const relativePath = source.slice("@/convex/_generated/".length);
        return resolveAppFile("convex/_generated", relativePath);
      }

      let appDir = importer.includes("/apps/platform/")
        ? "apps/platform"
        : importer.includes("/apps/web/")
        ? "apps/web"
        : importer.includes("/apps/marketing/")
        ? "apps/marketing"
        : null;

      // Shared tests outside an app (e.g., tests/unit) test platform code by
      // default, so resolve their `@/` aliases to apps/platform.
      if (!appDir && importer.includes("/tests/unit/")) {
        appDir = "apps/platform";
      }

      if (!appDir) {
        return null;
      }

      const resolved = resolveAppFile(appDir, source);
      return resolved;
    },
  };
}

/**
 * Vitest Unit Test Configuration
 *
 * Run tests:
 *   pnpm test:unit           # Run all unit tests
 *   pnpm test:unit:ui        # Run with UI
 *   pnpm test:unit --watch   # Watch mode
 */
export default defineConfig({
  plugins: [appAliasResolver(), react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: [path.resolve(__dirname, "./tests/unit/setup.tsx")],
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
      // Workspace package aliases
      "@mentorships/marketing": path.resolve(__dirname, "./apps/marketing"),
      "@mentorships/db": path.resolve(__dirname, "./packages/db/src"),
      "@mentorships/payments": path.resolve(__dirname, "./packages/payments/src"),
      "@mentorships/security": path.resolve(__dirname, "./packages/security/src"),
    },
  },
});
