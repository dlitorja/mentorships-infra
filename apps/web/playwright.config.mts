import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Playwright E2E Test Configuration
 * 
 * Run tests:
 *   pnpm test              # Run all tests
 *   pnpm test:ui           # Run with UI
 *   pnpm test --project=chromium  # Run specific browser
 */
export default defineConfig({
  testDir: path.resolve(__dirname, "../../tests/e2e"),
  
  testIgnore: ["**/waitlist.spec.ts"],
  
  fullyParallel: true,
  
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI ? "github" : "html",
  
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || "http://localhost:3000",
    
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",
    
    /* Screenshot on failure */
    screenshot: "only-on-failure",
    
    /* Video on failure */
    video: "retain-on-failure",
  },

  /* Configure projects for major browsers */
  projects: process.env.CI
    ? [
        {
          name: "chromium",
          use: { ...devices["Desktop Chrome"] },
        },
      ]
    : [
        {
          name: "chromium",
          use: { ...devices["Desktop Chrome"] },
        },
        {
          name: "firefox",
          use: { ...devices["Desktop Firefox"] },
        },
        {
          name: "webkit",
          use: { ...devices["Desktop Safari"] },
        },
      ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    env: {
      // Only pass environment variables that are actually set
      // This prevents empty strings from overriding Next.js defaults
      ...(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && {
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      }),
      ...(process.env.CLERK_SECRET_KEY && {
        CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
      }),
      ...(process.env.NEXT_PUBLIC_SUPABASE_URL && {
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      }),
      ...(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && {
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      }),
      ...(process.env.DATABASE_URL && {
        DATABASE_URL: process.env.DATABASE_URL,
      }),
      ...(process.env.STRIPE_SECRET_KEY && {
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      }),
      ...(process.env.STRIPE_WEBHOOK_SECRET && {
        STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
      }),
      ...(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY && {
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      }),
    },
  },
});

