import { test, expect } from "@playwright/test";

import { installDailyStub } from "./helpers/daily-stub";

/**
 * E2E tests for the Phase 11 vertical-stack desktop layout in
 * `apps/platform/components/workspace/workspace-client-page.tsx`.
 *
 * Phase 11 swaps the pre-#4c-4 horizontal split (`chat | video`,
 * default 60/40) for a vertical stack (`video on top, active tab on
 * bottom`, default 60/40 video) on desktop (≥ 900px). Phone (< 600px)
 * and tablet (600–899px) branches are unchanged — these tests focus
 * on the desktop branch and the boundary cases.
 *
 * ## Fixture requirements
 *
 * Running these tests requires:
 *
 *   1. **Clerk test user with an active workspace + call.** The CI
 *      preview deployment is seeded via
 *      `scripts/seed-test-workspaces.ts`; locally, run the same
 *      script and sign in with the test instructor / student user.
 *   2. **Storage state at `playwright/.auth/user.json`.** Generate it
 *      via the `auth.setup.ts` Playwright setup project (configured
 *      in `apps/platform/playwright.config.mts`); the spec uses
 *      `test.use({ storageState: ... })` so the browser starts
 *      already authenticated.
 *   3. **Daily backend stub.** `installDailyStub(page)` patches
 *      `window.Daily` / `window.DailyIframe` so `<VideoPanel>` can
 *      reach the `joined` state without provisioning a real Daily
 *      room.
 *
 * If any of the above is missing locally, the tests skip with a
 * clear message rather than timing out — that is intentional, not a
 * regression in the new code.
 */

test.use({ storageState: "playwright/.auth/user.json" });

const WORKSPACE_URL = "/workspace";

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

test.describe("Video call — vertical-stack desktop (1280×720)", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await installDailyStub(page);
  });

  test("renders the vertical stack on desktop (≥ 900px)", async ({ page }) => {
    await page.goto(WORKSPACE_URL);

    // `react-resizable-panels` Group exposes
    // `data-panel-group-direction="vertical"` on the root. Phase 11
    // mounts the desktop branch as vertical; the pre-#4c-4 branch
    // used horizontal and is gone.
    const group = page.locator("[data-panel-group-direction='vertical']");
    await expect(group).toBeVisible({ timeout: 15_000 });

    // Phone full-screen branch must NOT be active at this width.
    await expect(page.getByTestId("video-panel-fullscreen")).toHaveCount(0);
  });

  test("video panel sits above the active tab content (DOM order)", async ({
    page,
  }) => {
    await page.goto(WORKSPACE_URL);

    // Wait for the vertical group to mount (call reached "joined").
    const group = page.locator("[data-panel-group-direction='vertical']");
    await expect(group).toBeVisible({ timeout: 15_000 });

    // Phase 11 panel ids inside `<TabContentWithVideo>` desktop branch:
    //   id="video"  — top panel, contains `<VideoPanel>`.
    //   id="content" — bottom panel, contains the active tab body.
    const videoPanel = page.locator("[data-panel-id='video']");
    const contentPanel = page.locator("[data-panel-id='content']");
    await expect(videoPanel).toBeVisible();
    await expect(contentPanel).toBeVisible();

    // DOM order: the video panel comes before the content panel so
    // visual order is "video above, content below".
    const order = await page.evaluate(() => {
      const v = document.querySelector("[data-panel-id='video']");
      const c = document.querySelector("[data-panel-id='content']");
      if (!v || !c) return null;
      // DOCUMENT_POSITION_FOLLOWING = 4.
      const relation = v.compareDocumentPosition(c);
      return Boolean(relation & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order).toBe(true);
  });

  test("video panel persists across tab switches (Chat → Notes → Links)", async ({
    page,
  }) => {
    await page.goto(WORKSPACE_URL);
    await expect(
      page.locator("[data-panel-group-direction='vertical']")
    ).toBeVisible({ timeout: 15_000 });

    // Default tab is "chat". Switch to Notes and back; the video panel
    // must remain mounted and the call pill must still read "In call".
    await page.getByRole("tab", { name: /Notes/ }).click();
    await expect(
      page.locator("[data-panel-id='video']")
    ).toBeVisible();
    await expect(page.getByText(/In call/)).toBeVisible();

    // Notes composer textarea is the active tab body now. The exact
    // label varies by editor mode, so assert via aria role.
    await expect(
      page.locator("[data-panel-id='content']")
    ).toBeVisible();

    await page.getByRole("tab", { name: /Links/ }).click();
    await expect(
      page.locator("[data-panel-id='video']")
    ).toBeVisible();
    await expect(page.getByText(/In call/)).toBeVisible();

    await page.getByRole("tab", { name: /Chat/ }).click();
    await expect(
      page.locator("[data-panel-id='video']")
    ).toBeVisible();
    await expect(page.getByText(/In call/)).toBeVisible();
  });

  test("resize to tablet (800px) falls back to floating PiP, not the stack", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(WORKSPACE_URL);
    await expect(
      page.locator("[data-panel-group-direction='vertical']")
    ).toBeVisible({ timeout: 15_000 });

    // Shrink below 900px — the vertical Group must unmount and the
    // floating PiP must mount. We use 800px (inside the 600–899
    // tablet branch).
    await page.setViewportSize({ width: 800, height: 720 });
    await expect(
      page.locator("[data-panel-group-direction='vertical']")
    ).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: /Video call with/ })).toBeVisible(
      { timeout: 5_000 }
    );
  });
});

test.describe("Video call — desktop split ratio persistence", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await installDailyStub(page);
  });

  test("persists the vertical split ratio under the Phase 11 v2 key", async ({
    page,
    context,
  }) => {
    await page.goto(WORKSPACE_URL);
    const group = page.locator("[data-panel-group-direction='vertical']");
    await expect(group).toBeVisible({ timeout: 15_000 });

    // Read the v2 storage key written by `useSplitRatio`. The legacy
    // key ("video-call-split-ratio") MUST NOT be present — Phase 11
    // bumped the key so old values don't silently flip the semantic.
    const stored = await page.evaluate(() => {
      const v2 = window.localStorage.getItem("video-call-split-ratio:v2");
      const legacy = window.localStorage.getItem("video-call-split-ratio");
      return { v2, legacy };
    });
    expect(stored.v2).not.toBeNull();
    expect(stored.legacy).toBeNull();

    // Clear the v2 entry and reload — the default ratio (60) should
    // be restored on the next mount.
    await context.clearCookies();
    await page.evaluate(() => window.localStorage.removeItem("video-call-split-ratio:v2"));
    await page.reload();
    await expect(group).toBeVisible({ timeout: 15_000 });

    const restored = await page.evaluate(() =>
      window.localStorage.getItem("video-call-split-ratio:v2")
    );
    expect(restored).not.toBeNull();
  });
});
