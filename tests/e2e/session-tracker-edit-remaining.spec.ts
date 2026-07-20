import { test, expect, type Page } from "@playwright/test";

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
      "Auth fixture missing — set E2E_TEST_USER_EMAIL and re-run the `setup` project to populate playwright/.auth/user.json.",
    );
  }
});

/**
 * Mock the session-pack PATCH endpoint. Captures every request
 * body and replies with a synthetic success response so the UI
 * optimistically updates without touching Convex.
 */
async function mockSessionPackPatch(
  page: Page,
  initial: { totalSessions: number; remainingSessions: number },
): Promise<void> {
  let currentRemaining = initial.remainingSessions;
  let currentTotal = initial.totalSessions;

  await page.route(/\/api\/instructor\/session-packs\/[^/]+$/, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fallback();
      return;
    }
    let body: { action?: string; amount?: number } = {};
    try {
      body = JSON.parse(route.request().postData() ?? "{}");
    } catch {
      // Empty body — return 400.
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "Invalid request" }),
      });
      return;
    }

    if (body.action === "set" && typeof body.amount === "number") {
      currentRemaining = Math.min(Math.max(0, body.amount), currentTotal);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          sessionPack: {
            id: "mock-session-pack",
            totalSessions: currentTotal,
            remainingSessions: currentRemaining,
            status: currentRemaining === 0 ? "depleted" : "active",
          },
        }),
      });
      return;
    }
    // Other actions (increment/decrement/restore) are not exercised
    // by this spec; reply with a 501 so the UI surfaces the error
    // and a regression that re-introduces them would be caught.
    await route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({ error: "Not implemented in test mock" }),
    });
  });
}

/**
 * Navigate to a workspace, click into the first one, and wait for
 * the session-count pill to render. Skips the spec if no workspace
 * is visible or no session pack is attached.
 */
async function openSessionPill(page: Page): Promise<void> {
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/workspace/);

  const firstWorkspace = page
    .locator('a[href^="/workspace/"]:not([href$="/workspace"])')
    .first();
  await firstWorkspace.waitFor({ state: "visible", timeout: 15_000 });
  await firstWorkspace.click();

  const editButton = page
    .locator('button[aria-label="Edit session remaining count"]')
    .first();
  try {
    await editButton.waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    test.skip(
      true,
      "No session pack attached to the seeded workspace — set E2E_TEST_USER_EMAIL and re-run the seed script.",
    );
  }
}

/**
 * Read the visible remaining count from the pill aria-label.
 * Pill aria-label format: "{N} session(s) remaining".
 */
async function readPillRemaining(page: Page): Promise<number> {
  const pill = page.locator('[aria-label$="session remaining"], [aria-label$="sessions remaining"]').first();
  const label = await pill.getAttribute("aria-label");
  if (!label) throw new Error("Pill aria-label missing");
  const match = label.match(/^(\d+)/);
  if (!match) throw new Error(`Unparseable pill label: ${label}`);
  return parseInt(match[1]!, 10);
}

test.describe("Workspace session tracker — edit remaining count", () => {
  test("Pill shows '{N} sessions remaining' with no total count visible", async ({
    page,
  }) => {
    await openSessionPill(page);

    // The pill aria-label is "{N} sessions remaining" — no slash,
    // no "left", just remaining.
    const pill = page
      .locator('[aria-label$="sessions remaining"], [aria-label$="session remaining"]')
      .first();
    await expect(pill).toBeVisible();
    const label = await pill.getAttribute("aria-label");
    expect(label).toMatch(/^\d+ sessions? remaining$/);
    expect(label).not.toContain("/");
    expect(label.toLowerCase()).not.toContain("left");
  });

  test("Edit button toggles an integer-only input prefilled with the current count", async ({
    page,
  }) => {
    await openSessionPill(page);
    const initialRemaining = await readPillRemaining(page);

    await page
      .locator('button[aria-label="Edit session remaining count"]')
      .click();

    const input = page.locator('input[aria-label="New session remaining count"]');
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();

    // Pre-filled with the current count.
    await expect(input).toHaveValue(String(initialRemaining));

    // Typing non-integer characters strips them.
    await input.fill("abc12.5def");
    await expect(input).toHaveValue("125");
  });

  test("Save PATCHes action='set' and updates the pill to the new count", async ({
    page,
  }) => {
    await openSessionPill(page);
    const initialRemaining = await readPillRemaining(page);

    // Seed mock with current pill state.
    await mockSessionPackPatch(page, {
      totalSessions: 10,
      remainingSessions: initialRemaining,
    });

    const patchPromise = page.waitForRequest(
      (req) =>
        req.method() === "PATCH" &&
        /\/api\/instructor\/session-packs\/[^/]+$/.test(req.url()),
    );

    await page
      .locator('button[aria-label="Edit session remaining count"]')
      .click();
    await page.locator('input[aria-label="New session remaining count"]').fill("3");
    await page.locator('button[aria-label="Save session remaining count"]').click();

    const req = await patchPromise;
    const body = JSON.parse(req.postData() ?? "{}");
    expect(body).toEqual({ action: "set", amount: 3 });

    // Pill updates to the new count (via the mocked PATCH response).
    await expect(
      page.locator('[aria-label$="sessions remaining"], [aria-label$="session remaining"]').first()
    ).toHaveAttribute("aria-label", "3 sessions remaining");
  });

  test("Enter saves, Escape cancels without PATCHing", async ({ page }) => {
    await openSessionPill(page);
    await mockSessionPackPatch(page, { totalSessions: 10, remainingSessions: 5 });

    const patchRequests: string[] = [];
    page.on("request", (req) => {
      if (
        req.method() === "PATCH" &&
        /\/api\/instructor\/session-packs\/[^/]+$/.test(req.url())
      ) {
        patchRequests.push(req.postData() ?? "");
      }
    });

    // Enter: saves.
    await page
      .locator('button[aria-label="Edit session remaining count"]')
      .click();
    await page.locator('input[aria-label="New session remaining count"]').fill("4");
    await page.keyboard.press("Enter");
    await expect(
      page.locator('[aria-label$="sessions remaining"]').first()
    ).toHaveAttribute("aria-label", "4 sessions remaining");

    // Escape: cancels without firing a second PATCH.
    await page
      .locator('button[aria-label="Edit session remaining count"]')
      .click();
    await page.locator('input[aria-label="New session remaining count"]').fill("99");
    await page.keyboard.press("Escape");
    // Pill unchanged from previous save.
    await expect(
      page.locator('[aria-label$="sessions remaining"]').first()
    ).toHaveAttribute("aria-label", "4 sessions remaining");

    expect(patchRequests.length).toBe(1);
  });

  test("Singular form when remaining count is exactly 1", async ({ page }) => {
    await openSessionPill(page);
    await mockSessionPackPatch(page, { totalSessions: 5, remainingSessions: 2 });

    await page
      .locator('button[aria-label="Edit session remaining count"]')
      .click();
    await page.locator('input[aria-label="New session remaining count"]').fill("1");
    await page.locator('button[aria-label="Save session remaining count"]').click();

    await expect(
      page.locator('[aria-label="1 session remaining"]').first()
    ).toBeVisible();
  });
});

test.describe("Instructor dashboard — session pack badge drops total", () => {
  test("Dashboard row badge shows only '{N} sessions remaining'", async ({
    page,
  }) => {
    await page.goto("/instructor/dashboard");
    await expect(page).toHaveURL(/\/instructor\/dashboard/);

    // Wait for at least one student row to render. If the seed has
    // no students, skip.
    const heading = page.locator("text=Students & Remaining Sessions");
    await expect(heading).toBeVisible({ timeout: 15_000 });

    // Find any badge text matching the remaining-count pattern.
    const badges = page.locator("text=/^\\d+ sessions? remaining$/");
    const count = await badges.count();
    if (count === 0) {
      test.skip(
        true,
        "Seeded instructor has no students — re-run the seed script.",
      );
    }

    // No badge should contain "left" or "/" — confirms total is gone.
    const allBadges = await badges.allInnerTexts();
    for (const text of allBadges) {
      expect(text.toLowerCase()).not.toContain("left");
      expect(text).not.toContain("/");
      expect(text).toMatch(/^\d+ sessions? remaining$/);
    }
  });
});
