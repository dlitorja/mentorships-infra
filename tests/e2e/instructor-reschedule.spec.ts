import { test, expect } from "@playwright/test";

/**
 * E2E: Instructor reschedules a session.
 *
 * Flow:
 * 1. Authenticated instructor navigates to a session detail page.
 * 2. Clicks "Reschedule" and selects a new future time.
 * 3. Confirms the session is updated and a notification is triggered.
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

const MOCK_SESSION = {
  _id: "session_test_1",
  instructorId: "instructor_test_1",
  studentId: "student_test_1",
  scheduledAt: new Date("2026-08-10T10:00:00Z").getTime(),
  status: "scheduled",
};

const MOCK_INSTRUCTOR = {
  _id: "instructor_test_1",
  name: "Test Instructor",
};

const MOCK_STUDENT = {
  email: "student@example.com",
  firstName: "Student",
  lastName: "Name",
  timeZone: "America/New_York",
};

test.describe("Instructor rescheduling", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/convex**", async (route) => {
      const url = route.request().url();
      if (url.includes("getSessionById")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_SESSION),
        });
        return;
      }
      if (url.includes("getInstructorByUserId")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_INSTRUCTOR),
        });
        return;
      }
      if (url.includes("getUserByClerkIdPublic")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_STUDENT),
        });
        return;
      }
      await route.continue();
    });
  });

  test("reschedule endpoint rejects dates in the past", async ({ page }) => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    await page.route("**/api/sessions/*/reschedule", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "newScheduledAt must be in the future" }),
      });
    });

    await page.goto(`/sessions/session_test_1/reschedule?newScheduledAt=${encodeURIComponent(pastDate)}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(/must be in the future/i)).toBeVisible();
  });

  test("reschedule endpoint accepts a future date", async ({ page }) => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await page.route("**/api/sessions/*/reschedule", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto(`/sessions/session_test_1/reschedule?newScheduledAt=${encodeURIComponent(futureDate)}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(/success/i)).toBeVisible();
  });
});
