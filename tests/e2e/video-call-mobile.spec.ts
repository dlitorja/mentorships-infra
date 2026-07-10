import { test, expect } from "@playwright/test";

import { installDailyStub } from "./helpers/daily-stub";

/**
 * E2E tests for the PR #4c-4 narrow-viewport layouts in
 * `apps/platform/components/video/`.
 *
 * These tests exercise the three breakpoint branches of
 * `<VideoPanel>` and `<ChatTabWithVideo>`:
 *
 *   - < 600px (iPhone SE, 375×667): full-screen video + bottom-sheet
 *     `<WorkspaceDrawer>` for the workspace chat.
 *   - 600–899px (tablet portrait, 500×800): floating PiP, no split.
 *   - ≥ 900px (small laptop, 1280×720): resizable split panel.
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

// Storage state is created once by the `setup` Playwright project.
// The path is relative to the playwright config's working dir (repo
// root). When the file is empty (E2E_TEST_USER_EMAIL unset), the
// beforeAll hook below skips each test instead of failing.
test.use({ storageState: "playwright/.auth/user.json" });

const WORKSPACE_URL = "/workspace";

// Clerk's session cookie name. Set by the Clerk test-mode sign-in
// flow; absent when `auth.setup.ts` saved an empty storage state.
const CLERK_SESSION_COOKIE = "__session";

/**
 * Verify the storage state contains a Clerk session cookie before
 * running any spec. Without a session, `/workspace` redirects to
 * `/sign-in` and the assertions below can never pass — better to
 * skip with a clear message than to fail with a 30-second timeout.
 */
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

test.describe("Video call — mobile (375×667)", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test.beforeEach(async ({ page }) => {
    await installDailyStub(page);
  });

  test("renders full-screen video at < 600px", async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    await expect(page.getByTestId("video-panel-fullscreen")).toBeVisible({
      timeout: 15_000,
    });
    // The bottom-sheet drawer is not visible by default — the user
    // opens it explicitly via the floating button.
    await expect(page.getByTestId("workspace-drawer")).toHaveCount(0);
  });

  test("opens the workspace drawer via the floating button", async ({
    page,
  }) => {
    await page.goto(WORKSPACE_URL);
    await expect(page.getByTestId("video-panel-fullscreen")).toBeVisible({
      timeout: 15_000,
    });

    const openBtn = page.getByTestId("workspace-drawer-open");
    await expect(openBtn).toBeVisible();
    await openBtn.click();

    const drawer = page.getByTestId("workspace-drawer");
    await expect(drawer).toBeVisible();
    await expect(page.getByTestId("workspace-drawer-handle")).toBeVisible();
  });

  test("Quick Capture overlay centers within viewport", async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    await expect(page.getByTestId("video-panel-fullscreen")).toBeVisible({
      timeout: 15_000,
    });

    // Trigger the Cmd/Ctrl+K shortcut. Playwright treats modifier+K
    // via keyboard.down / up.
    await page.keyboard.press("Control+K");

    // Quick Capture's Radix Dialog renders into a portal; assert by
    // the dialog title text (matches quick-capture.tsx:97).
    await expect(page.getByRole("dialog").filter({ hasText: "Quick capture" })).toBeVisible(
      { timeout: 5_000 }
    );

    const dialog = page.getByRole("dialog").filter({ hasText: "Quick capture" });
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // Dialog must not overflow the 375px viewport. Allow a 2rem
      // gutter on each side (matches the new `max-w-[calc(100vw-2rem)]`
      // utility at quick-capture.tsx:87).
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(375);
    }
  });
});

test.describe("Video call — tablet portrait (500×800)", () => {
  test.use({ viewport: { width: 500, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await installDailyStub(page);
  });

  test("forces floating PiP at 600–899px (no split panel)", async ({
    page,
  }) => {
    await page.goto(WORKSPACE_URL);
    // Phone branch never mounts at this width, so full-screen is
    // absent.
    await expect(page.getByTestId("video-panel-fullscreen")).toHaveCount(0);
    // The desktop split uses `react-resizable-panels`; assert it is
    // NOT rendered at tablet-portrait width. Phase 11 flipped the
    // desktop split direction from horizontal to vertical, so the
    // selector must check BOTH orientations — otherwise a vertical
    // split panel accidentally rendered at 500 px would slip through
    // CI undetected.
    await expect(
      page.locator("[data-panel-group-direction='horizontal']")
    ).toHaveCount(0);
    await expect(
      page.locator("[data-panel-group-direction='vertical']")
    ).toHaveCount(0);
    // Floating PiP mounts as a fixed-positioned dialog with a
    // known aria-label from picture-in-picture.tsx:140.
    await expect(page.getByRole("dialog", { name: /Video call with/ })).toBeVisible(
      { timeout: 15_000 }
    );
  });
});

test.describe("Video call — small laptop (1280×720)", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await installDailyStub(page);
  });

  test("renders the resizable split panel at ≥ 900px", async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    // `react-resizable-panels` Group container has
    // `data-panel-group-direction="vertical"` on the root (Phase 11
    // flipped desktop from horizontal to vertical — the previous
    // `horizontal` assertion was only passing because the Clerk
    // fixture isn't seeded in CI; once it is, the old selector would
    // have missed the visible group).
    const group = page.locator("[data-panel-group-direction='vertical']");
    await expect(group).toBeVisible({ timeout: 15_000 });
    // The phone full-screen branch must NOT be active.
    await expect(page.getByTestId("video-panel-fullscreen")).toHaveCount(0);
  });
});
