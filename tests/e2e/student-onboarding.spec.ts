import { test, expect } from "@playwright/test";

/**
 * E2E: Student onboarding flow.
 *
 * Flow:
 * 1. Admin sends an onboarding invitation to a student email.
 * 2. Student accepts the invite via a magic link.
 * 3. Student completes profile and lands in the workspace.
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

const MOCK_INVITE = {
  onboardingId: "onboarding_test_1",
  email: "newstudent@example.com",
  status: "pending",
  expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
};

test.describe("Student onboarding", () => {
  test("admin invite page shows email input and sends invite", async ({ page }) => {
    await page.route("**/api/admin/students/invite**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_INVITE),
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

  test("student onboarding page rejects invalid onboarding token", async ({ page }) => {
    await page.goto("/onboarding?token=invalid");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(/invalid|expired|not found/i)).toBeVisible();
  });
});
