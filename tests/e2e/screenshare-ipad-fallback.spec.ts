import { test, expect, type Page } from "@playwright/test";

import { installExtendedDailyStub } from "./helpers/daily-stub-extended";

/**
 * Device-level regression test for the iPadOS 27 screen-share fallback
 * (PR #1078).
 *
 * Daily's call machine treats mobile browsers as receive-only, so plain
 * `startScreenShare()` is a silent no-op on an iPad — even on iPadOS 27,
 * where Safari finally exposes `getDisplayMedia`. The app therefore
 * captures the screen itself and hands the stream to Daily via
 * `startScreenShare({ mediaStream })`.
 *
 * This spec emulates an iPad at the browser level:
 *   - an iPadOS 27 desktop-class user agent (Safari on iPad reports
 *     `Macintosh`), plus `maxTouchPoints > 1` so
 *     `isTouchPrimaryDevice()` returns true;
 *   - a real `getDisplayMedia` implementation backed by
 *     `HTMLCanvasElement.captureStream()` — a genuine `MediaStream`
 *     with a live video track, not a plain object;
 *   - the extended Daily stub, which records the options the app passes
 *     to `startScreenShare`.
 *
 * It then asserts the whole handoff: one capture request, a live video
 * track handed to Daily with the balanced send preset, the UI flipping
 * to "Stop screen share", and the track being stopped on stop.
 *
 * ## Fixture requirements
 *
 * Same as `video-call-mobile.spec.ts`:
 *   1. Clerk test user with an active workspace + joinable session
 *      (seeded via `scripts/seed-test-workspaces.ts`).
 *   2. `playwright/.auth/user.json` from the `setup` project.
 *
 * Without the auth fixture the spec skips rather than timing out.
 */

const IPADOS_27_SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15";

test.use({
  storageState: "playwright/.auth/user.json",
  viewport: { width: 820, height: 1180 },
  hasTouch: true,
  userAgent: IPADOS_27_SAFARI_UA,
});

const CLERK_SESSION_COOKIE = "__session";
const WORKSPACE_BASE = "/workspace";

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

/**
 * Mock the consent + token routes so `useVideoCall.join()` completes
 * without the production video token service. Mirrors
 * `call-bug-fixes.spec.ts`.
 */
async function mockVideoRoutes(page: Page): Promise<void> {
  await page.route("**/api/video/consent/**", (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ ok: true }) })
  );
  await page.route("**/api/video/token/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        token: "stub-token",
        roomName: "stub-room",
        roomUrl: "https://stub.daily.co/stub-room",
      }),
    })
  );
}

/**
 * Pretend to be an iPad on iPadOS 27 and provide a real screen-capture
 * implementation backed by a canvas stream.
 *
 * `addInitScript` runs before any app bundle, so both
 * `isTouchPrimaryDevice()` and `isScreenShareSupported()` see the iPad
 * shape on their first render.
 */
async function installIpadScreenCapture(
  page: Page,
  delayMs = 0
): Promise<void> {
  await page.addInitScript((captureDelayMs: number) => {
    // iPadOS reports a desktop Macintosh UA; touch points are the only
    // reliable mobile signal (Playwright's `hasTouch` alone gives 1).
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      get: () => 5,
    });

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices) return;

    const state: {
      calls: number;
      lastStream: MediaStream | null;
    } = { calls: 0, lastStream: null };
    (window as unknown as { __ipadScreenCapture: typeof state })[
      "__ipadScreenCapture"
    ] = state;

    mediaDevices.getDisplayMedia = async () => {
      state.calls += 1;
      if (captureDelayMs > 0) {
        // Hold the "picker" open so a test can tap again while the
        // request is pending.
        await new Promise((resolve) =>
          setTimeout(resolve, captureDelayMs)
        );
      }
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext("2d");
      // One draw is enough to make captureStream produce a frame; the
      // app only needs a live video track to hand to Daily.
      if (ctx) {
        ctx.fillStyle = "#1f2937";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#f9fafb";
        ctx.fillRect(40, 40, 240, 120);
      }
      const stream = canvas.captureStream(1);
      state.lastStream = stream;
      return stream;
    };
  }, delayMs);
}

/** Click through to a joined call, mirroring `call-bug-fixes.spec.ts`. */
async function joinSeededCall(page: Page): Promise<void> {
  await page.goto(WORKSPACE_BASE);
  await expect(page).toHaveURL(/\/workspace/);

  const firstWorkspace = page
    .locator('a[href^="/workspace/"]:not([href$="/workspace"])')
    .first();
  await firstWorkspace.waitFor({ state: "visible", timeout: 15_000 });
  await firstWorkspace.click();

  await expect(page.getByText(/Join Call|Open call/)).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: /Join Call|Open call/ }).click();

  const consentContinue = page
    .getByRole("button")
    .filter({ hasNotText: /Cancel|Decline/ })
    .first();
  if (await consentContinue.isVisible().catch(() => false)) {
    await consentContinue.click();
  }

  await expect(page.getByTestId("call-overlay")).toBeVisible({
    timeout: 15_000,
  });
}

type ShareHarness = {
  captureCalls: number;
  tracks: { kind: string; readyState: string }[];
  dailyStartCalls: number;
  dailyStopCalls: number;
  dailyArgs: {
    hasMediaStream: boolean;
    videoTrackCount: number;
    hasLiveVideoTrack: boolean;
    screenVideoSendSettings: string | null;
  } | null;
};

async function readShareHarness(page: Page): Promise<ShareHarness> {
  return page.evaluate(() => {
    const host = window as unknown as {
      __ipadScreenCapture?: {
        calls: number;
        lastStream: MediaStream | null;
      };
      __dailyScreenShareCalls?: number;
      __dailyStopScreenShareCalls?: number;
      __dailyScreenShareArgs?: ShareHarness["dailyArgs"];
    };
    const stream = host.__ipadScreenCapture?.lastStream ?? null;
    return {
      captureCalls: host.__ipadScreenCapture?.calls ?? 0,
      tracks: stream
        ? stream.getTracks().map((track) => ({
            kind: track.kind,
            readyState: track.readyState,
          }))
        : [],
      dailyStartCalls: host.__dailyScreenShareCalls ?? 0,
      dailyStopCalls: host.__dailyStopScreenShareCalls ?? 0,
      dailyArgs: host.__dailyScreenShareArgs ?? null,
    };
  });
}

test.describe("iPadOS 27 screen share (self-captured stream)", () => {
  test.beforeEach(async ({ page }) => {
    await mockVideoRoutes(page);
    await installExtendedDailyStub(page);
  });

  test("captures the screen and hands a live stream to Daily", async ({
    page,
  }) => {
    await installIpadScreenCapture(page);
    await joinSeededCall(page);

    const shareButton = page.getByRole("button", {
      name: "Start screen share",
    });
    await expect(shareButton).toBeEnabled({ timeout: 15_000 });

    // No capability toast on a device that exposes getDisplayMedia.
    await shareButton.click();
    await expect(
      page.getByText("Screen sharing isn't available")
    ).toHaveCount(0);

    // One real capture, handed to Daily as a MediaStream.
    await expect
      .poll(async () => (await readShareHarness(page)).captureCalls, {
        timeout: 5_000,
      })
      .toBe(1);
    await expect
      .poll(async () => (await readShareHarness(page)).dailyStartCalls, {
        timeout: 5_000,
      })
      .toBe(1);

    const afterStart = await readShareHarness(page);
    expect(afterStart.dailyArgs).not.toBeNull();
    expect(afterStart.dailyArgs?.hasMediaStream).toBe(true);
    expect(afterStart.dailyArgs?.videoTrackCount).toBe(1);
    expect(afterStart.dailyArgs?.hasLiveVideoTrack).toBe(true);
    expect(afterStart.dailyArgs?.screenVideoSendSettings).toBe(
      "motion-and-detail-balanced"
    );
    expect(afterStart.tracks).toEqual([
      { kind: "video", readyState: "live" },
    ]);

    // Daily's start event flips the control to the stop state.
    await expect(
      page.getByRole("button", { name: "Stop screen share" })
    ).toBeVisible({ timeout: 5_000 });

    // Stopping releases both Daily and our capture.
    await page.getByRole("button", { name: "Stop screen share" }).click();
    await expect
      .poll(async () => (await readShareHarness(page)).dailyStopCalls, {
        timeout: 5_000,
      })
      .toBe(1);
    await expect
      .poll(async () => (await readShareHarness(page)).tracks, {
        timeout: 5_000,
      })
      .toEqual([{ kind: "video", readyState: "ended" }]);
  });

  test("does not start a second capture while the first is pending", async ({
    page,
  }) => {
    // Keep the first request pending long enough for the second tap to
    // land while it is in flight.
    await installIpadScreenCapture(page, 1500);
    await joinSeededCall(page);

    const shareButton = page.getByRole("button", {
      name: "Start screen share",
    });
    await expect(shareButton).toBeEnabled({ timeout: 15_000 });

    // Double-tap before Daily confirms. The pending guard must collapse
    // both taps into one capture request.
    await shareButton.click();
    await shareButton.click({ force: true });

    await expect
      .poll(async () => (await readShareHarness(page)).captureCalls, {
        timeout: 5_000,
      })
      .toBe(1);
    await expect
      .poll(async () => (await readShareHarness(page)).dailyStartCalls, {
        timeout: 5_000,
      })
      .toBe(1);
  });
});
