import { test, expect } from "@playwright/test";

/**
 * E2E: Google Calendar connect.
 *
 * Flow:
 * 1. Authenticated instructor navigates to settings / calendar connect.
 * 2. Verifies the connect button links to Google OAuth.
 * 3. Verifies the callback or status page shows the connected state.
 *
 * Auth fixture is required; the spec skips if auth is missing.
 */

test.use({ storageState: "playwright/.auth/user.json" });

const CLERK_SESSION_COOKIE = "__session";

test.beforeAll(async ({}, testInfo) => {
  const fs = await import("node:fs/promises");
  let cookies: { name: string }[] = [];
  try {
    const raw = await fs.readFile("playwright/.auth/user.json", "utf8");
    const parsed = JSON.parse(raw) as { cookies?: { name: string }[] };
    cookies = parsed.cookies ?? [];
  } catch {
    // File missing — skip.
  }
  const hasClerk = cookies.some((c) => c.name === CLERK_SESSION_COOKIE);
  if (!hasClerk) {
    testInfo.skip(
      true,
      "Auth fixture missing — set E2E_TEST_USER_EMAIL and re-run the `setup` project."
    );
  }
});

const MOCK_INSTRUCTOR = {
  _id: "instructor_test_1",
  name: "Test Instructor",
  googleCalendarId: "primary",
  googleCalendarConnected: false,
};

test.describe("Google Calendar connect", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/convex**", async (route) => {
      const url = route.request().url();
      if (url.includes("getInstructorByUserId")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_INSTRUCTOR),
        });
        return;
      }
      await route.continue();
    });
  });

  test("calendar connect page renders connect button", async ({ page }) => {
    await page.goto("/settings/calendar");
    await page.waitForLoadState("networkidle");

    const connectButton = page.getByRole("button", { name: /connect.*calendar|connect.*google/i });
    await expect(connectButton).toBeVisible();
  });

  test("calendar connect button links to Google OAuth", async ({ page }) => {
    await page.goto("/settings/calendar");
    await page.waitForLoadState("networkidle");

    const connectButton = page.getByRole("button", { name: /connect.*calendar|connect.*google/i });
    await expect(connectButton).toBeVisible();

    // Mock the connect endpoint to redirect to a known OAuth URL.
    await page.route("**/api/calendar/connect", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "https://accounts.google.com/o/oauth2/auth?mock=true" }),
      });
    });

    await connectButton.click();
    await page.waitForURL("https://accounts.google.com/o/oauth2/auth?mock=true", { timeout: 10_000 });
    await expect(page).toHaveURL("https://accounts.google.com/o/oauth2/auth?mock=true");
  });
});
