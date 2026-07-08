import { test, expect, type Page } from "@playwright/test";

import { installDailyStub } from "./helpers/daily-stub";

/**
 * E2E tests for PR #5: the "Shared during current call" subpanel
 * in the Links tab widens to include instructor resources (PR #4c-3
 * shipped the link half; this PR adds the resource half).
 *
 * The spec exercises:
 *   1. Upload an image via the Resources tab dropzone.
 *   2. Click the Tag toggle on the row → resource appears in the
 *      Links tab's subpanel with a "Resource" type badge.
 *   3. Click the Untag toggle → resource disappears from the
 *      subpanel.
 *
 * ## Fixture requirements
 *
 *   1. **Clerk test user with an active workspace + call.** Seeded
 *      via `scripts/seed-test-workspaces.ts` which (PR #5) creates
 *      a session pack and an active `sessions` row via the test-only
 *      `instructorResources:seedActiveSessionForE2E` mutation.
 *   2. **Storage state at `playwright/.auth/user.json`.** Generated
 *      by the `setup` Playwright project (`auth.setup.ts`).
 *   3. **Daily backend stub.** `installDailyStub(page)` patches
 *      `window.Daily` so `<VideoPanel>` can reach the `joined`
 *      state without provisioning a real Daily room.
 *
 * Without all three, the spec skips with a clear message rather
 * than timing out (matching `video-call-mobile.spec.ts:58-75`).
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
      "Auth fixture missing — set E2E_TEST_USER_EMAIL and re-run the `setup` project to populate playwright/.auth/user.json.",
    );
  }
});

/**
 * Navigate to the workspace, switch to the Resources tab, and
 * upload a 1×1 PNG via the react-dropzone file input. Returns
 * when the resource row is rendered so the caller can click the
 * Tag/Untag toggle.
 *
 * react-dropzone renders a hidden `<input type="file" multiple>`
 * inside the dropzone container. `getInputProps()` from
 * `react-dropzone` attaches a `data-testid`-equivalent ARIA role
 * — for simplicity, we target the first `<input type="file">` on
 * the page since the dropzone is the only file uploader on the
 * Resources tab.
 */
async function uploadSeedResource(page: Page): Promise<void> {
  await page.goto(WORKSPACE_URL);
  const trigger = page.getByRole("tab", { name: /My Resources/i });
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();

  await expect(
    page.getByText(/Drag & drop files here, or click to select/i),
  ).toBeVisible({ timeout: 10_000 });

  // The dropzone's hidden file input is the only `input[type=file]`
  // on the page when the Resources tab is mounted.
  const fileInput = page.locator("input[type='file']").first();
  await expect(fileInput).toBeAttached({ timeout: 5_000 });

  // Tiny 1×1 PNG payload so the upload completes quickly. The
  // file name must end in .png so `resources.tsx:54` detects
  // `type === 'image'`.
  const tinyPng = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
    0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00,
    0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  await fileInput.setInputFiles({
    name: "seed-resource.png",
    mimeType: "image/png",
    buffer: tinyPng,
  });

  // Wait for the upload to complete and the row to render. The
  // resource's filename appears in a `<p class="text-xs truncate">`
  // inside the row.
  await expect(page.getByText("seed-resource.png")).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("PR #5 — instructor resources share-to-call (1280×720)", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await installDailyStub(page);
  });

  test("tagging a resource surfaces it in the Links subpanel with a Resource badge", async ({
    page,
  }) => {
    await uploadSeedResource(page);

    // PR #5: the Tag toggle on the resource row. Only renders when
    // `activeSessionId` is non-null (seeded session). Mirrors
    // resources.tsx:308-320.
    const tagButton = page.getByRole("button", {
      name: /Tag to current call/i,
    }).first();
    await expect(tagButton).toBeVisible({ timeout: 10_000 });
    await tagButton.click();

    // Switch to the Links tab and assert the subpanel renders the
    // resource. `data-testid="shared-during-call-subpanel"` is the
    // single selector for the unioned subpanel (links + resources)
    // — same testid as PR #4c-3.
    const linksTrigger = page.getByRole("tab", { name: /Links/i });
    await expect(linksTrigger).toBeVisible({ timeout: 5_000 });
    await linksTrigger.click();

    const subpanel = page.getByTestId("shared-during-call-subpanel");
    await expect(subpanel).toBeVisible({ timeout: 10_000 });

    // Type badge "Resource" appears at least once (matches
    // resources.tsx:62-66 + links.tsx union renderer). The
    // filename also appears inside the subpanel.
    await expect(subpanel.getByText(/^Resource$/i).first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(subpanel.getByText("seed-resource.png")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("untag removes the resource from the subpanel", async ({ page }) => {
    await uploadSeedResource(page);

    const tagButton = page.getByRole("button", {
      name: /Tag to current call/i,
    }).first();
    await expect(tagButton).toBeVisible({ timeout: 10_000 });
    await tagButton.click();

    // After tagging, the Untag button replaces the Tag button on
    // that row.
    const untagButton = page.getByRole("button", {
      name: /Untag from current call/i,
    }).first();
    await expect(untagButton).toBeVisible({ timeout: 5_000 });
    await untagButton.click();

    const linksTrigger = page.getByRole("tab", { name: /Links/i });
    await linksTrigger.click();

    const subpanel = page.getByTestId("shared-during-call-subpanel");
    await expect(subpanel).toBeVisible({ timeout: 10_000 });

    // After untag, the subpanel should show the empty state copy
    // "No links or resources shared yet this call".
    await expect(
      subpanel.getByText(/No links or resources shared yet this call/i),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("the Resource row carries the dedicated data-testid for downstream selectors", async ({
    page,
  }) => {
    await uploadSeedResource(page);

    const tagButton = page.getByRole("button", {
      name: /Tag to current call/i,
    }).first();
    await tagButton.click();

    const linksTrigger = page.getByRole("tab", { name: /Links/i });
    await linksTrigger.click();

    const subpanel = page.getByTestId("shared-during-call-subpanel");
    await expect(subpanel).toBeVisible({ timeout: 10_000 });

    // PR #5: per-row data-testid so future tests can target
    // resource rows specifically without relying on the union
    // order. Mirrors the links.tsx `data-testid="shared-during-call-subpanel-row-link"`.
    await expect(
      subpanel.locator(
        '[data-testid="shared-during-call-subpanel-row-resource"]',
      ),
    ).toHaveCount(1, { timeout: 5_000 });
  });

  // PR #5 R1 nit: assert the Tag toggle is rendered as a Tag button
  // when the resource is untagged, swaps to an Untag button after a
  // click, and the "Tagged" badge appears optimistically (not after
  // a refetch). Guards the optimistic-state UX that resources.tsx
  // gained in this PR — without it, regressions that defer the
  // toggle state update until the query refetches would slip
  // through. Uses a 5s timeout (rather than the 1s originally
  // proposed) to absorb slow CI runners — the assertion is still
  // tighter than waiting for a subpanel refetch (~10s+).
  test("the Tag toggle UX swaps states optimistically", async ({ page }) => {
    await uploadSeedResource(page);

    const tagButton = page.getByRole("button", {
      name: /Tag to current call/i,
    }).first();
    await expect(tagButton).toBeVisible({ timeout: 10_000 });

    // No "Tagged" badge before tagging.
    await expect(page.getByText(/^Tagged$/i)).toHaveCount(0);

    await tagButton.click();

    // Optimistic: the Untag button + Tagged badge appear BEFORE any
    // explicit wait for the subpanel refetch.
    await expect(
      page.getByRole("button", { name: /Untag from current call/i }).first(),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/^Tagged$/i).first()).toBeVisible({
      timeout: 5_000,
    });
  });
});
