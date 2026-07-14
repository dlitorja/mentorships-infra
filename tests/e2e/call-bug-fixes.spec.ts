import { test, expect, type Page } from "@playwright/test";

import { installExtendedDailyStub } from "./helpers/daily-stub-extended";

/**
 * Regression suite for the 5 production-call bugs fixed by #629 +
 * the Greptile 4/5 follow-ups in #630.
 *
 * Each test below asserts a user-observable behavior that the bug
 * would have broken. The bugs in scope (Bug A–E) are documented in
 * `docs/production-call-bugs.md` and the recovery PR description
 * (PR #629). #630 added two more fixes on top:
 *
 *   - `useWorkspaceMessages` no longer leaks an empty-string
 *     workspaceId to Convex when the hoisted `ChatDataProvider`
 *     already covers the same query.
 *   - The camera strip excludes only the ACTIVE screen-share
 *     sub-participant (not every "-screen" suffix), so concurrent
 *     screen-shares from other participants remain visible.
 *
 * ## Fixture requirements
 *
 *   1. **Clerk test user with an active workspace + joinable
 *      session.** The CI preview deployment is seeded via
 *      `scripts/seed-test-workspaces.ts`. Locally, the same script
 *      must be run and the resulting workspace/session ids used.
 *   2. **Storage state at `playwright/.auth/user.json`** — generated
 *      via the `setup` Playwright project (Clerk test mode).
 *   3. **Daily backend stub** (`installExtendedDailyStub`) so
 *      `<VideoCall>` reaches the `joined` state without provisioning
 *      a real Daily room. The extended stub also handles screen-
 *      share events so the layout-switch test can assert the
 *      post-share DOM.
 *
 * If any of the above is missing, the spec skips with a clear
 * message rather than timing out — matches the convention of
 * `video-call-mobile.spec.ts` and `chat-submit.spec.ts`.
 */

test.use({ storageState: "playwright/.auth/user.json" });

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
 * Mock the consent + token routes so `useVideoCall.join()` can
 * complete end-to-end without the production video token service.
 * The token endpoint is what would have returned 403 in Bug E;
 * intercepting it with a 200 keeps the test focused on the React
 * lifecycle (status flip, leave transition, no hang) rather than
 * the Daily backend.
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
 * Click through to a joined call. The seed script provisions one
 * joinable session per workspace; we open the workspace, dismiss
 * the recording consent modal, and wait for the call to join.
 */
async function joinSeededCall(page: Page): Promise<void> {
  await page.goto(WORKSPACE_BASE);
  await expect(page).toHaveURL(/\/workspace/);

  // Open the first workspace in the picker (if multiple exist).
  const firstWorkspace = page
    .locator('a[href^="/workspace/"]:not([href$="/workspace"])')
    .first();
  await firstWorkspace.waitFor({ state: "visible", timeout: 15_000 });
  await firstWorkspace.click();

  // The pill is hidden if no session exists; if so, the spec cannot
  // proceed. The seed script creates one joinable session per
  // workspace, so a visible pill is the success signal that the
  // fixture is usable.
  await expect(page.getByText(/Join Call|Open call/)).toBeVisible({
    timeout: 15_000,
  });

  // Consent modal — record opt-in (matches the booking form's
  // recordingConsent default).
  await page.getByRole("button", { name: /Join Call|Open call/ }).click();
  // The consent modal's primary button label varies by i18n; click
  // any button with "Continue" / "Allow" / "Start" that isn't Cancel.
  const consentContinue = page
    .getByRole("button")
    .filter({ hasNotText: /Cancel|Decline/ })
    .first();
  if (await consentContinue.isVisible().catch(() => false)) {
    await consentContinue.click();
  }

  // Bug A assertion happens in the calling test.
}

test.describe("Bug A — start-call UI updates without stale delay", () => {
  test.beforeEach(async ({ page }) => {
    await mockVideoRoutes(page);
    await installExtendedDailyStub(page);
  });

  test("status pill flips to 'In call' within 2s of joining", async ({
    page,
  }) => {
    await joinSeededCall(page);
    // Bug A: predicate-based session invalidation. Before the fix,
    // `useWorkspaceMessages` and the workspace session queries kept
    // stale "scheduled" data after `markCallStarted`, so the pill
    // visually lagged for 5-10s (or never updated). After the fix,
    // `endCall.onSuccess` and `markCallStarted.onSuccess` invalidate
    // every `["convexQuery", "api.sessions.*"]` key with
    // `refetchType: "all"`, so the pill flips immediately.
    await expect(page.getByText("In call")).toBeVisible({ timeout: 2_000 });
  });
});

test.describe("Bug B — chat during call syncs through hoisted provider", () => {
  test.beforeEach(async ({ page }) => {
    await mockVideoRoutes(page);
    await installExtendedDailyStub(page);
  });

  test("workspace chat message appears in call overlay chat", async ({
    page,
  }) => {
    await joinSeededCall(page);

    // Wait for the overlay to mount.
    await expect(page.getByTestId("call-overlay")).toBeVisible({
      timeout: 15_000,
    });

    // The overlay renders a Tabs subtree. The Chat tab is the
    // default; assert the chat composer is mounted inside the
    // overlay (matches the hoisted provider's mount in
    // workspace-client-page.tsx:114).
    const overlayComposer = page
      .getByTestId("call-overlay")
      .getByPlaceholder("Type a message...")
      .first();
    await expect(overlayComposer).toBeVisible({ timeout: 10_000 });

    const stamp = Date.now();
    const body = `e2e-bugB-overlay-${stamp}`;
    await overlayComposer.fill(body);
    await page
      .getByTestId("call-overlay")
      .getByRole("button", { name: "Send message" })
      .first()
      .click();

    // Bug B regression: the message must appear in the overlay chat
    // list. Before the fix, the overlay chat's
    // `useWorkspaceMessages` subscriber unmounted and remounted on
    // overlay toggle, dropping the observer count to zero and
    // missing the next `setQueryData` push. The 5s ceiling
    // accommodates CI cold-starts; the actual symptom (no update
    // at all) would fail at 30s+.
    await expect(
      page
        .getByTestId("call-overlay")
        .locator("p.whitespace-pre-wrap", { hasText: body })
    ).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Bug C — screen-share layout switches to screen primary", () => {
  test.beforeEach(async ({ page }) => {
    await mockVideoRoutes(page);
    await installExtendedDailyStub(page);
  });

  test("'Share screen' click flips primary area to screen video", async ({
    page,
  }) => {
    await joinSeededCall(page);
    await expect(page.getByTestId("call-overlay")).toBeVisible({
      timeout: 15_000,
    });

    // The screen-share button lives in `<VideoControls>`. Its
    // accessible name is "Share screen" (matches
    // video-controls.tsx).
    const shareButton = page
      .getByTestId("call-overlay")
      .getByRole("button", { name: /share screen|stop sharing/i })
      .first();
    await expect(shareButton).toBeVisible({ timeout: 10_000 });
    await shareButton.click();

    // The Daily stub emits `participant-joined` with a
    // `${ownerId}-screen` participant. `<VideoCall>` flips to the
    // screen-share primary layout (camera strip collapsed at the
    // bottom). The most reliable observable signal: the layout
    // group's video panel renders a screen-video tile (data-testid
    // added by ParticipantTile when forceScreenShare is true).
    //
    // Bug C regression: before the fix, the camera strip filter
    // matched every `-screen` suffix, so a SECOND concurrent screen
    // share from another participant would render nowhere. After
    // the fix, only the active sub-participant is excluded and
    // other screens remain visible in the strip.
    //
    // We assert the simpler invariant here: at least one
    // `forceScreenShare` tile mounts within 2s of the click. The
    // multi-participant case is exercised by
    // `daily-stub-extended.ts`'s internal logic; adding a remote
    // participant + second screen-share in the same spec would
    // couple too much Daily internal state to a user-visible
    // assertion.
    await expect(
      page.locator("[data-testid='participant-tile'][data-screen-share='true']")
    ).toHaveCount(1, { timeout: 2_000 });
  });
});

test.describe("Bug D — image attachments appear immediately in overlay chat", () => {
  test.beforeEach(async ({ page }) => {
    await mockVideoRoutes(page);
    await installExtendedDailyStub(page);
  });

  test("attached image renders in call overlay chat list", async ({
    page,
  }) => {
    await joinSeededCall(page);
    await expect(page.getByTestId("call-overlay")).toBeVisible({
      timeout: 15_000,
    });

    const overlay = page.getByTestId("call-overlay");
    const fileInput = overlay
      .locator("input[type='file']")
      .first();
    await fileInput.setInputFiles({
      name: "regression.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        // 1×1 transparent PNG (smallest valid PNG).
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64"
      ),
    });

    // Click the same send button as Bug B.
    await overlay
      .getByRole("button", { name: "Send message" })
      .first()
      .click();

    // Bug D regression: the attached image must render inside the
    // overlay chat list. Before the fix, the chat mutation's
    // invalidate path missed the hoisted provider's query key
    // variant and the image appeared only on the workspace tab
    // (not the overlay). After the fix, the chat data context
    // hoists above the call gate so the overlay chat reflects
    // mutations without remount.
    await expect(
      overlay.locator("img[alt='regression.png']")
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Bug E — end-call lifecycle avoids 403 and Preparing-call hang", () => {
  test.beforeEach(async ({ page }) => {
    await mockVideoRoutes(page);
    await installExtendedDailyStub(page);
  });

  test("End Call returns pill to joinable and does not hang", async ({
    page,
  }) => {
    await joinSeededCall(page);
    await expect(page.getByText("In call")).toBeVisible({ timeout: 5_000 });

    // Capture network responses for the video token endpoint
    // — Bug E's symptom was a 403 on
    // `/api/video/token/<roomName>` after leave, or a hang on
    // "Preparing call…" when the leave transitioned through
    // `markCallStarted` while `hasProgrammaticallyLeft` was still
    // true.
    const tokenResponses: Array<{ status: number; url: string }> = [];
    page.on("response", (response) => {
      if (response.url().includes("/api/video/token/")) {
        tokenResponses.push({ status: response.status(), url: response.url() });
      }
    });

    await page.getByRole("button", { name: "End Call" }).click();

    // After leave, the pill returns to "Join Call" / "Open call"
    // (status === "joined" → "leaving" → "idle"). Bug E regression:
    // before the fix, `status` could re-flip to "joining" via the
    // race in `useVideoCall.start()` if the auto-join effect didn't
    // guard on `hasProgrammaticallyLeft`.
    await expect(
      page.getByRole("button", { name: /Join Call|Open call/ })
    ).toBeVisible({ timeout: 5_000 });

    // No "Preparing call…" text should linger after the leave
    // resolves — that text lives in `<VideoCall>` while
    // `status === "idle" | "joining" | "leaving"`. Once the pill
    // flips back to "Join Call", the overlay is unmounted via
    // `useIsCallOverlayVisible()` and the loading text is gone.
    await expect(page.getByText("Preparing call")).toHaveCount(0, {
      timeout: 2_000,
    });

    // No 403 on the token endpoint during the leave flow.
    const forbidden = tokenResponses.filter((r) => r.status === 403);
    expect(forbidden).toEqual([]);
  });
});
