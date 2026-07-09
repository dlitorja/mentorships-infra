import { test, expect } from "@playwright/test";

/**
 * Regression test for the chat-tab breakage fix.
 *
 * Bug summary: after PR #4b introduced the sentinel-shaped
 * `"0000…01"` ids + `enabled: false` pattern in
 * `useLiveSessionNote` / `useNoteComments`, `@convex-dev/react-query`
 * `subscribeInner` ignored `enabled: false` on first render and
 * leaked the sentinel through to the server's `v.id(...)`
 * validators. Combined with the
 * `<QueryProvider><ConvexClientProvider>` ordering bug (Clerk's
 * `setAuth` only fires post-render, so `useConvexAuth()` was
 * `false` on first paint) and the `requireIdentity`-throwing
 * `getUnreadForUser` / `getUnreadForWorkspace` notifications, the
 * chat tab rendered an empty list silently while a mutation
 * succeeded server-side.
 *
 * This spec exercises the user-visible symptom: type a message,
 * submit, and assert the text appears in the chat list.
 *
 * ## Fixture requirements (mirrors video-call-mobile.spec.ts)
 *
 *   1. Clerk test user with an active workspace.
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

test.describe("Workspace chat — submit + render", () => {
  test("typed message appears in the chat list after submit", async ({
    page,
  }) => {
    // Land on the workspace picker; assume at least one workspace is
    // visible after sign-in (the seed script populates one).
    await page.goto("/workspace");
    await expect(page).toHaveURL(/\/workspace/);

    // Open the first workspace in the picker (if multiple exist).
    // The picker rows are `<a>` links to `/workspace/<id>`.
    const firstWorkspace = page
      .locator('a[href^="/workspace/"]:not([href$="/workspace"])')
      .first();
    await firstWorkspace.waitFor({ state: "visible", timeout: 15_000 });
    await firstWorkspace.click();

    // Wait for the chat tab; if the workspace loads on the Resources
    // tab by default, click into the Chat tab first.
    const chatTab = page.getByRole("tab", { name: /chat/i }).first();
    if (await chatTab.isVisible().catch(() => false)) {
      await chatTab.click();
    }

    // The chat textarea uses placeholder "Type a message...".
    const composer = page.getByPlaceholder("Type a message...").first();
    await composer.waitFor({ state: "visible", timeout: 15_000 });

    const stamp = Date.now();
    const body = `e2e-chat-regression-${stamp}`;

    await composer.fill(body);
    await page.getByRole("button", { name: "Send message" }).first().click();

    // The chat list re-renders the new message via Convex's
    // subscription; wait for the text to appear (the symptom of the
    // bug was that it never did).
    await expect(
      page.locator("p.whitespace-pre-wrap", { hasText: body })
    ).toBeVisible({ timeout: 10_000 });
  });
});
