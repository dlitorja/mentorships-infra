import { test, expect, type Page } from "@playwright/test";

/**
 * Regression test for the workspace session tracker reset button.
 *
 * Bug summary: the instructor-only session-count pill on a
 * workspace (`SessionCountControls` in
 * `apps/platform/components/workspace/session-count-controls.tsx`)
 * exposes `+` and `−` buttons that adjust the session pack's
 * `remainingSessions` and (for `+`) `totalSessions` columns in
 * Convex. There was no way to undo those adjustments short of
 * clicking the toast's Undo button (which only persists for a
 * few seconds and only undoes the last action). If the
 * instructor inflated the total by clicking `+`, the visual
 * "X / Y sessions left" reads exactly like a usage counter
 * being bumped — which is confusing.
 *
 * This spec exercises the user-visible symptom: click `+` once,
 * click the new Reset button (with confirm), and assert the
 * pill returns to its page-load value. Repeat for `−`.
 *
 * ## Fixture requirements
 *
 *   1. Clerk test user with an active workspace whose
 *      `selectedWorkspace.sessionPackId` is set.
 *   2. Storage state at `playwright/.auth/user.json` from
 *      `auth.setup.ts`.
 *
 * The PATCH endpoint is mocked hermetically so the spec does not
 * mutate real session pack data. The mock mirrors the
 * `addSessionsToPack` / `removeSessionsFromPack` /
 * `restoreSessionCounts` mutation semantics from
 * `convex/sessionPacks.ts`.
 *
 * If the auth fixture is missing, the spec skips with a clear
 * message rather than timing out on `/sign-in` (matches the
 * convention used in `chat-submit.spec.ts:36-53`).
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
      "Auth fixture missing — set E2E_TEST_USER_EMAIL and re-run the `setup` project to populate playwright/.auth/user.json.",
    );
  }
});

/**
 * Hermetic mock of the session-pack PATCH endpoint. Mirrors the
 * behavior of `addSessionsToPack`, `removeSessionsFromPack`, and
 * `restoreSessionCounts` from `convex/sessionPacks.ts`. The mock
 * maintains in-memory state per `sessionPackId` so the spec
 * behaves exactly like the real backend without mutating Convex.
 *
 * `initialState` is the real starting count read from the page-load
 * pill label — the component reads the session pack from a Convex
 * subscription, not from a PATCH response, so the mock needs to
 * be told the starting value before any PATCH fires. Without this
 * seed, the mock's hardcoded default of {4, 4} would mismatch
 * real seed data and break subsequent assertions.
 *
 * The mock enforces the optimistic-concurrency check used by the
 * `restore` action: if the client's `expectedTotalSessions` /
 * `expectedRemainingSessions` don't match the mock's current
 * state, it returns 409, mirroring the `SESSION_PACK_UNDO_CONFLICT`
 * path in `restoreSessionCounts`.
 */
async function mockSessionPackPatch(
  page: Page,
  initialState: { totalSessions: number; remainingSessions: number },
): Promise<void> {
  const state = new Map<string, typeof initialState>([["", initialState]]);
  let seeded = false;

  await page.route("**/api/instructor/session-packs/**", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    const url = new URL(route.request().url());
    const segments = url.pathname.split("/");
    const sessionPackId = segments[segments.length - 1] ?? "";
    const body = (JSON.parse(route.request().postData() ?? "{}") as {
      action?: string;
      amount?: number;
      totalSessions?: number;
      remainingSessions?: number;
      expectedTotalSessions?: number;
      expectedRemainingSessions?: number;
    }) ?? {};

    // Seed the mock with the real starting state on the first PATCH
    // for a given pack id. Subsequent PATCHes for the same pack read
    // and mutate the mock's own state.
    if (!seeded) {
      state.set(sessionPackId, initialState);
      seeded = true;
    }
    const current = state.get(sessionPackId) ?? initialState;

    let next = { ...current };
    if (body.action === "increment" && typeof body.amount === "number") {
      next = {
        totalSessions: current.totalSessions + body.amount,
        remainingSessions: current.remainingSessions + body.amount,
      };
    } else if (body.action === "decrement" && typeof body.amount === "number") {
      next = {
        totalSessions: current.totalSessions,
        remainingSessions: Math.max(0, current.remainingSessions - body.amount),
      };
    } else if (body.action === "restore") {
      if (
        body.expectedTotalSessions !== current.totalSessions ||
        body.expectedRemainingSessions !== current.remainingSessions
      ) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Session pack changed before undo could be applied",
          }),
        });
        return;
      }
      next = {
        totalSessions: body.totalSessions ?? current.totalSessions,
        remainingSessions: body.remainingSessions ?? current.remainingSessions,
      };
    }
    state.set(sessionPackId, next);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        sessionPack: {
          id: sessionPackId,
          totalSessions: next.totalSessions,
          remainingSessions: next.remainingSessions,
          status: next.remainingSessions === 0 ? "depleted" : "active",
        },
      }),
    });
  });
}

/**
 * Parse the pill's "X / Y sessions left" text into a count object.
 * Falls back to totalSessions: 4, remainingSessions: 4 if the pill
 * isn't visible — that should never happen because openSessionPill
 * already skipped if no pill was found.
 */
async function readPillState(page: Page): Promise<{
  totalSessions: number;
  remainingSessions: number;
}> {
  const pill = page.locator('[aria-label$="sessions remaining"]').first();
  const label = await pill.getAttribute("aria-label");
  const remaining = parseInt(label!.split(" ")[0]!, 10);
  // The aria-label only encodes the remaining count. Read the
  // visible "X / Y" text from the count div to recover total.
  const text = (await pill.innerText()).trim();
  const match = text.match(/^(\d+)\s*\/\s*(\d+)\s+sessions left$/);
  if (!match) {
    throw new Error(`Unexpected pill text: ${JSON.stringify(text)}`);
  }
  return {
    remainingSessions: parseInt(match[1]!, 10),
    totalSessions: parseInt(match[2]!, 10),
  };
}

/**
 * Open the workspace picker, click into the first workspace, and
 * wait for the session-count pill. Skips the spec gracefully if no
 * workspace is visible (e.g. seed didn't run) or if no session pack
 * is attached.
 */
async function openSessionPill(page: Page): Promise<void> {
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/workspace/);

  const firstWorkspace = page
    .locator('a[href^="/workspace/"]:not([href$="/workspace"])')
    .first();
  await firstWorkspace.waitFor({ state: "visible", timeout: 15_000 });
  await firstWorkspace.click();

  // The reset button is the most reliable selector — only rendered
  // when the instructor has a session pack attached. If the workspace
  // has no pack, skip this spec entirely.
  const resetButton = page
    .locator('button[aria-label^="Reset session count to"]')
    .first();
  try {
    await resetButton.waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    test.skip(
      true,
      "No session pack attached to the seeded workspace — set E2E_TEST_USER_EMAIL and re-run the seed script.",
    );
  }
}

test.describe("Workspace session tracker — Reset button", () => {
  test.beforeEach(async ({ page }) => {
    await openSessionPill(page);
    // Seed the mock with the real page-load state read from the
    // pill label, so subsequent PATCH responses are consistent
    // with the Convex subscription the component already used to
    // render the initial count.
    await mockSessionPackPatch(page, await readPillState(page));
  });

  test("Reset undoes a manual `+` increment back to the page-load state", async ({
    page,
  }) => {
    const pill = page.locator('[aria-label$="sessions remaining"]').first();
    await expect(pill).toBeVisible();

    const initialLabel = await pill.getAttribute("aria-label");
    // Page-load state: "X sessions remaining" where X = remainingSessions
    // at the time the component mounted. Capture it for later assertions.
    expect(initialLabel).toMatch(/^\d+ sessions remaining$/);
    const initialRemaining = parseInt(initialLabel!.split(" ")[0]!, 10);

    // Click `+` — increment both total and remaining by 1.
    await page
      .locator('button[aria-label="Add a session credit to this student\'s pack"]')
      .click();

    // Wait for the pill to re-render with the new count.
    await expect
      .poll(async () => {
        const label = await pill.getAttribute("aria-label");
        const remaining = parseInt(label!.split(" ")[0]!, 10);
        return remaining;
      }, { timeout: 5_000 })
      .toBe(initialRemaining + 1);

    // Click Reset. The component uses `window.confirm` — auto-accept.
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await page
      .locator('button[aria-label^="Reset session count to"]')
      .click();

    // Pill should return to the page-load value.
    await expect
      .poll(async () => {
        const label = await pill.getAttribute("aria-label");
        return label;
      }, { timeout: 5_000 })
      .toBe(initialLabel);
  });

  test("Reset undoes a manual `−` decrement back to the page-load state", async ({
    page,
  }) => {
    const pill = page.locator('[aria-label$="sessions remaining"]').first();
    await expect(pill).toBeVisible();

    const initialLabel = await pill.getAttribute("aria-label");
    expect(initialLabel).toMatch(/^\d+ sessions remaining$/);
    const initialRemaining = parseInt(initialLabel!.split(" ")[0]!, 10);

    // If we're already at 0 we can't decrement; skip the decrement
    // half and just verify the reset is enabled (no-op state) or
    // disabled (already at snapshot).
    if (initialRemaining === 0) {
      test.skip(
        true,
        "Session pack is already at 0 remaining — cannot exercise `−`.",
      );
      return;
    }

    await page
      .locator('button[aria-label="Mark one session as completed (decrement remaining)"]')
      .click();

    await expect
      .poll(async () => {
        const label = await pill.getAttribute("aria-label");
        const remaining = parseInt(label!.split(" ")[0]!, 10);
        return remaining;
      }, { timeout: 5_000 })
      .toBe(initialRemaining - 1);

    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await page
      .locator('button[aria-label^="Reset session count to"]')
      .click();

    await expect
      .poll(async () => {
        const label = await pill.getAttribute("aria-label");
        return label;
      }, { timeout: 5_000 })
      .toBe(initialLabel);
  });

  test("Reset button is disabled when current state already matches the page-load snapshot", async ({
    page,
  }) => {
    const resetButton = page
      .locator('button[aria-label^="Reset session count to"]')
      .first();
    await expect(resetButton).toBeVisible();

    // On a freshly loaded workspace with no manual adjustments, the
    // current count == page-load snapshot, so Reset should be
    // disabled.
    await expect(resetButton).toBeDisabled();

    // Click `+` — Reset becomes enabled.
    await page
      .locator('button[aria-label="Add a session credit to this student\'s pack"]')
      .click();

    // Wait for the Reset button to flip to enabled.
    await expect(resetButton).toBeEnabled({ timeout: 5_000 });
  });
});
