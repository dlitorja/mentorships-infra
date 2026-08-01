import { test, expect } from "@playwright/test";

/**
 * E2E: Instructor reschedules a session from the sessions list.
 *
 * The instructor sessions page is `/instructor/sessions`. Each session card
 * uses the `SessionActions` component, which opens a reschedule dialog and calls
 * `/api/sessions/[sessionId]/reschedule` on submit.
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

const futureDate = new Date();
futureDate.setDate(futureDate.getDate() + 7);

const MOCK_INSTRUCTOR = {
  _id: "instructor_test_1",
  name: "Test Instructor",
  timeZone: "America/New_York",
};

const MOCK_SESSION = {
  _id: "session_test_1",
  instructorId: "instructor_test_1",
  studentId: "student_test_1",
  scheduledAt: new Date("2026-08-10T10:00:00Z").getTime(),
  status: "scheduled",
  notes: "",
  sessionPackId: "pack_test_1",
  remainingSessions: 4,
  studentEmail: "student@example.com",
};

test.describe("Instructor rescheduling", () => {
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
      if (url.includes("useInstructorAllSessions") || url.includes("getInstructorAllSessions")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            page: [MOCK_SESSION],
            continueCursor: null,
            isDone: true,
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.route("**/api/sessions/*/reschedule", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
        return;
      }
      await route.continue();
    });
  });

  test("opens reschedule dialog and submits a new future time", async ({ page }) => {
    await page.goto("/instructor/sessions");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "All Sessions" })).toBeVisible();
    await expect(page.getByText(MOCK_SESSION.studentEmail)).toBeVisible();

    await page.getByRole("button", { name: "Reschedule session" }).click();
    await expect(page.getByRole("dialog", { name: "Reschedule Session" })).toBeVisible();

    const newDateInput = page.locator("#new-datetime");
    await expect(newDateInput).toBeVisible();
    await newDateInput.fill(futureDate.toISOString().slice(0, 16));

    await page.getByRole("button", { name: "Reschedule", exact: false }).click();
    await expect(page.getByText("Session rescheduled")).toBeVisible();
  });

  test("reschedule endpoint rejects dates in the past", async ({ page }) => {
    await page.route("**/api/sessions/*/reschedule", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "newScheduledAt must be in the future" }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/instructor/sessions");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Reschedule session" }).click();
    await expect(page.getByRole("dialog", { name: "Reschedule Session" })).toBeVisible();

    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await page.locator("#new-datetime").fill(pastDate.toISOString().slice(0, 16));
    await page.getByRole("button", { name: "Reschedule", exact: false }).click();

    await expect(page.getByText(/must be in the future/i)).toBeVisible();
  });
});
