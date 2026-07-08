import { test as setup, expect } from "@playwright/test";

/**
 * Playwright auth setup for `apps/platform` E2E specs.
 *
 * Signs in via Clerk's test-mode email flow and saves the resulting
 * cookies to `playwright/.auth/user.json`. The video-call mobile spec
 * picks up this storage state with `test.use({ storageState: ... })`.
 *
 * Clerk test mode (`__clerk_test_mode=1` cookie or
 * `pk_test_*` publishable key) is detected by:
 *   - Entering the test user email.
 *   - Waiting for the magic-link confirmation UI.
 *   - Clerk test mode short-circuits the magic-link email and shows
 *     the verification URL inline; we click it.
 *
 * If `E2E_TEST_USER_EMAIL` is not set, this setup exits gracefully
 * (saves an empty storage state file) so specs that depend on auth
 * can detect the missing fixture and skip with a clear message
 * instead of timing out.
 *
 * Run before the main project:
 *   pnpm exec playwright test --config=apps/platform/playwright.config.mts --project=setup
 */

const TEST_USER_EMAIL = process.env.E2E_TEST_USER_EMAIL ?? "";

setup("sign in via Clerk test mode", async ({ page, context }) => {
  if (!TEST_USER_EMAIL) {
    console.warn(
      "[auth.setup] E2E_TEST_USER_EMAIL is not set — saving empty storage state; specs that require auth will skip."
    );
    // Save an empty storage state so dependent specs can detect the
    // missing fixture by checking for a known cookie.
    await context.storageState({ path: "playwright/.auth/user.json" });
    return;
  }

  await page.goto("/sign-in");

  // Clerk's sign-in UI varies by version; the email-link button is
  // the lowest-friction path. Type the test user email and submit.
  const emailInput = page.locator('input[name="emailAddress"], input[type="email"]').first();
  await emailInput.waitFor({ state: "visible", timeout: 15_000 });
  await emailInput.fill(TEST_USER_EMAIL);
  await page.getByRole("button", { name: /continue|sign in|magic link/i }).first().click();

  // In Clerk test mode the verification URL is rendered inline (the
  // magic-link email is intercepted by the test backend). Wait for
  // that URL to appear and click it.
  const verificationLink = page.locator('a[href*="verify"], a:has-text("Verify")');
  await verificationLink.first().waitFor({ state: "visible", timeout: 15_000 });
  await verificationLink.first().click();

  // Wait for the workspace page to load — confirms the session cookie
  // was set.
  await page.waitForURL(/\/workspace/, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/workspace/);

  await context.storageState({ path: "playwright/.auth/user.json" });
});
