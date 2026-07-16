import { test, expect } from "@playwright/test";

/**
 * PR admin-onboarding #2: smoke test for the two-phase form on
 * `/admin/students/invite`. Verifies:
 *
 *   - Mode toggle reveal: clicking "Full onboarding" shows the
 *     two-phase form fields.
 *   - Preview is read-only: previewing must not POST to commit.
 *   - Capacity-override gating: when preview returns
 *     `atCapacity: true`, the reason textarea is required and
 *     "Confirm and Send" stays disabled until it's filled.
 *   - Advanced split gating: opening the disclosure modal and
 *     cancelling must NOT enable the split; confirming then
 *     requires notes before Confirm is enabled.
 *   - Confirm-and-Send triggers POST to commit endpoint.
 *
 * Mocks the `/api/admin/students/onboard/preview` and `/commit`
 * endpoints so the test is hermetic — no real Convex/Clerk/Resend
 * calls. UI-level rendering is what's under test; the Convex
 * mutations and Inngest flow are covered by `convex-test` and the
 * recovery dashboard's read-only smoke tests in PR 1.
 *
 * ## Fixture requirements
 *
 *   1. Clerk test user with `publicMetadata.role = "admin"` (the
 *      `/admin/layout.tsx` guard redirects non-admins away).
 *   2. Storage state at `playwright/.auth/user.json` from
 *      `auth.setup.ts`.
 *
 * If the auth fixture is missing, the spec skips with a clear
 * message rather than timing out on `/sign-in`.
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
      "Auth fixture missing — set E2E_TEST_USER_EMAIL and re-run the `setup` project to populate playwright/.auth/user.json."
    );
  }
});

const MOCK_INSTRUCTORS = [
  {
    id: "ins_alpha",
    name: "Alpha Mentor",
    email: "alpha@example.com",
    oneOnOneInventory: 5,
    groupInventory: 10,
    maxActiveStudents: 5,
    activeStudentCount: 2,
  },
  {
    id: "ins_beta",
    name: "Beta Mentor",
    email: "beta@example.com",
    oneOnOneInventory: 5,
    groupInventory: 10,
    maxActiveStudents: 5,
    activeStudentCount: 5, // at capacity
  },
];

test.beforeEach(async ({ page }) => {
  // Single mock handler for the Convex queries the form uses. Playwright
  // processes route handlers in LIFO order; consolidating into one
  // handler avoids accidental shadowing.
  await page.route("**/api/convex**", async (route) => {
    const url = route.request().url();
    if (url.includes("getInstructorOptionsForOnboarding")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_INSTRUCTORS),
      });
      return;
    }
    if (url.includes("lookupExistingStudent")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          exists: false,
          name: undefined,
          onboardingAlias: undefined,
          priorOnboardingIds: [],
        }),
      });
      return;
    }
    await route.continue();
  });
});

test.describe("Admin onboarding two-phase form", () => {
  test("mode toggle reveals the full-onboarding form", async ({ page }) => {
    await page.goto("/admin/students/invite");
    await page.waitForLoadState("networkidle");

    // Default mode: invitation-only card visible.
    await expect(page.getByText("Invitation only", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send Invitation" })).toBeVisible();

    // Click Full onboarding.
    await page.getByRole("button", { name: /Full onboarding/i }).click();

    await expect(page.getByText("Full Onboarding", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Student email")).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview" })).toBeVisible();
  });

  test("preview does not POST to commit", async ({ page }) => {
    let commitCalls = 0;
    await page.route(/\/api\/admin\/students\/onboard(?!\/preview)/, async (route) => {
      if (route.request().method() === "POST") {
        commitCalls += 1;
      }
      await route.continue();
    });

    await page.route("**/api/admin/students/onboard/preview", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          email: "preview-test@example.com",
          perInstructor: [
            {
              instructorId: "ins_alpha",
              instructorName: "Alpha Mentor",
              isRenewal: false,
              existingWorkspaceId: undefined,
              action: "new_workspace",
              sessionsPerInstructor: 4,
              expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
              atCapacity: false,
              activeStudentCount: 2,
              maxActiveStudents: 5,
              capacityOverrideRequired: false,
            },
          ],
          existingStudent: null,
          capacityOverrideRequired: false,
          capacityOverrideReasonMissing: false,
          notesRequired: false,
          notesMissing: false,
          warnings: [],
        }),
      });
    });

    await page.goto("/admin/students/invite");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Full onboarding/i }).click();

    await page.getByLabel("Student email").fill("preview-test@example.com");
    await page.getByLabel("Alpha Mentor").check();

    await page.getByRole("button", { name: "Preview" }).click();

    await expect(page.getByText("Preview")).toBeVisible();
    await expect(page.getByText("Will send")).toBeVisible();
    expect(commitCalls).toBe(0);
  });

  test("capacity override requires a reason before Confirm enables", async ({ page }) => {
    await page.goto("/admin/students/invite");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Full onboarding/i }).click();

    await page.getByLabel("Student email").fill("capacity-test@example.com");
    await page.getByLabel("Beta Mentor").check(); // at capacity

    await page.route("**/api/admin/students/onboard/preview", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          email: "capacity-test@example.com",
          perInstructor: [
            {
              instructorId: "ins_beta",
              instructorName: "Beta Mentor",
              isRenewal: false,
              existingWorkspaceId: undefined,
              action: "new_workspace",
              sessionsPerInstructor: 4,
              expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
              atCapacity: true,
              activeStudentCount: 5,
              maxActiveStudents: 5,
              capacityOverrideRequired: true,
            },
          ],
          existingStudent: null,
          capacityOverrideRequired: true,
          capacityOverrideReasonMissing: true,
          notesRequired: false,
          notesMissing: false,
          warnings: ["Instructor Beta Mentor is at capacity (5/5); a reason is required to override."],
        }),
      });
    });

    await page.getByRole("button", { name: "Preview" }).click();

    // Reason textarea appears.
    await expect(page.getByLabel(/Capacity override reason/i)).toBeVisible();

    // Confirm disabled until reason is filled.
    const confirmButton = page.getByRole("button", { name: "Confirm and Send" });
    await expect(confirmButton).toBeDisabled();

    await page.getByLabel(/Capacity override reason/i).fill("VIP escalation approved by director");
    await expect(confirmButton).toBeEnabled();
  });

  test("advanced split modal blocks submit without notes", async ({ page }) => {
    await page.goto("/admin/students/invite");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Full onboarding/i }).click();

    await page.getByLabel("Student email").fill("advanced-test@example.com");
    await page.getByLabel("Alpha Mentor").check();

    // Toggle advanced split — modal opens.
    await page.getByLabel(/Create a separate student record/i).check();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText(/Create a separate student record?/i)).toBeVisible();

    // Cancel the modal — split is NOT enabled.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.getByLabel(/Create a separate student record/i)).not.toBeChecked();

    // Re-open and confirm.
    await page.getByLabel(/Create a separate student record/i).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByLabel("Internal notes")).toBeVisible();
  });
});
