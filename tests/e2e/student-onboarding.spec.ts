import { test, expect } from "@playwright/test";

/**
 * E2E: Student onboarding submission.
 *
 * The admin onboarding invitation flow lives at `/admin/students/invite`. The
 * student-facing onboarding form is at `/dashboard/onboarding` (legacy web
 * app). The instructor review page is at `/instructor/onboarding`.
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

const MOCK_ONBOARDING = {
  _id: "onboarding_test_1",
  email: "newstudent@example.com",
  status: "pending",
  expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
};

const MOCK_INSTRUCTOR = {
  _id: "instructor_test_1",
  name: "Test Instructor",
  timeZone: "America/New_York",
};

test.describe("Student onboarding", () => {
  test("admin invite page sends a student onboarding invitation", async ({ page }) => {
    await page.route("**/api/admin/students/invite**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_ONBOARDING),
      });
    });

    await page.goto("/admin/students/invite");
    await page.waitForLoadState("networkidle");

    const emailInput = page.getByLabel(/student email/i);
    await expect(emailInput).toBeVisible();

    await emailInput.fill("newstudent@example.com");
    await page.getByRole("button", { name: /send invitation|invite/i }).click();

    await expect(page.getByText(/invited|invitation sent/i)).toBeVisible();
  });

  test("instructor onboarding page shows a message when no submissions exist", async ({ page }) => {
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
      if (url.includes("listByInstructor")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            page: [],
            continueCursor: null,
            isDone: true,
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/instructor/onboarding");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Student Onboarding Submissions" })).toBeVisible();
    await expect(page.getByText("No onboarding submissions yet")).toBeVisible();
  });

  test.fixme("student can submit goals and images from /dashboard/onboarding", async () => {
    // The student onboarding form is in the legacy web app and requires an
    // active session pack. Exercise this flow against a seeded staging environment.
    expect(true).toBe(true);
  });
});
