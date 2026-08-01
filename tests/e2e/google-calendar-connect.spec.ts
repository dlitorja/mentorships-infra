import { test, expect } from "@playwright/test";

/**
 * E2E: Google Calendar connect for instructors.
 *
 * The Google Calendar card lives at `/instructor/availability` and links to
 * `/api/auth/google` to start the OAuth flow. This test verifies the card is
 * visible and the connect button points to the correct OAuth endpoint.
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
  timeZone: "America/New_York",
  workingHours: null,
  bufferMinutesBetweenSessions: null,
  minBookingLeadMinutes: null,
  maxBookingAdvanceDays: null,
  blockedDateRanges: null,
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
      if (url.includes("getGoogleCalendars")) {
        // 409 is the status used by the card to signal "not connected".
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "Google Calendar not connected" }),
        });
        return;
      }
      await route.continue();
    });
  });

  test("calendar connect card renders on the availability page", async ({ page }) => {
    await page.goto("/instructor/availability");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Availability" })).toBeVisible();
    await expect(page.getByText("Connect your Google Calendar")).toBeVisible();
    const connectButton = page.getByRole("link", { name: "Connect Google Calendar" });
    await expect(connectButton).toBeVisible();
    await expect(connectButton).toHaveAttribute("href", "/api/auth/google");
  });

  test("clicking connect navigates to the Google OAuth endpoint", async ({ page }) => {
    await page.goto("/instructor/availability");
    await page.waitForLoadState("networkidle");

    await page.getByRole("link", { name: "Connect Google Calendar" }).click();
    await page.waitForURL("/api/auth/google", { timeout: 10_000 });
    await expect(page).toHaveURL("/api/auth/google");
  });
});
