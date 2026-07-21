import { test, expect, type Page } from "@playwright/test";

/**
 * Regression test for the workspace Notes rich-text editor styles.
 *
 * Bug summary: the editor's content area uses Tailwind's `prose` class
 * (`apps/platform/components/workspace/notes.tsx:223`), which only
 * produces styles when the `@tailwindcss/typography` plugin is
 * installed. The plugin was missing from the monorepo, so
 * Tailwind's preflight reset was left unreplaced: `h1`–`h6` fell back
 * to `font-size: inherit; font-weight: inherit` (identical to `<p>`),
 * `<ul>`/`<ol>` lost their bullets/numbers, and `<pre>` had no
 * monospace/background styling. Users perceived H1/H2/H3, bullet
 * list, numbered list, and code block toolbar buttons as completely
 * broken even though the underlying TipTap commands worked.
 *
 * This spec exercises the user-visible symptom: clicking each
 * toolbar button, typing into the resulting block, and asserting
 * that the block's computed styles match what `@tailwindcss/typography`
 * applies to a `prose` container.
 *
 * ## Fixture requirements
 *
 *   1. Clerk test user with an active workspace + at least one note
 *      (or be able to create one in the Notes tab).
 *   2. Storage state at `playwright/.auth/user.json` from
 *      `auth.setup.ts`.
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
 * Mute the notes autosave so the test does not mutate real Convex
 * note content. Two transport paths exist:
 *
 *   1. REST create-note endpoint at `/api/workspace/notes` (POST).
 *   2. Convex HTTP transport at `<NEXT_PUBLIC_CONVEX_URL>/api/...`
 *      used by `useConvexMutation(api.workspaces.updateWorkspaceNote)`
 *      for the debounced autosave after the user types.
 *
 * Stubbing both keeps the test hermetic — the editor's `onUpdate`
 * fires, the mutation promise resolves, but no real database write
 * happens. The point of this spec is to verify rendering of editor
 * blocks, not persistence; persistence is covered by the unit tests
 * in `convex/workspaces.test.ts` and integration smoke tests
 * elsewhere.
 */
async function mockNotesAutosave(page: Page): Promise<void> {
  await page.route("**/api/workspace/notes", async (route) => {
    const req = route.request();
    if (req.method() === "POST" || req.method() === "PATCH") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
      return;
    }
    await route.continue();
  });

  // Stub any Convex HTTP transport call so the debounced autosave
  // (1s after the user types) doesn't reach the real deployment.
  // Convex's HTTP API returns JSON on `POST /api/...` endpoints;
  // a generic 200 with an empty value is enough for `useConvexMutation`
  // to resolve its promise without touching the database.
  await page.route(/\.convex\.cloud\/api\//, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "success", value: null }),
      });
      return;
    }
    await route.continue();
  });
}

/**
 * Navigate to the workspace picker, open the first workspace, and
 * switch to the Notes tab. The Notes tab can open in three states:
 *
 *   1. A note is already selected — `.ProseMirror` is visible.
 *   2. Notes exist but none selected — sidebar shows note rows but
 *      the editor hasn't mounted yet.
 *   3. No notes exist — sidebar is empty.
 *
 * This helper handles all three: if the editor isn't visible, it
 * first tries clicking the first existing note row in the sidebar
 * (rows are `<div>` with a FileText icon and the note title), and
 * if no rows exist it creates a new note via the Plus icon button.
 */
async function openNotesEditor(page: Page): Promise<void> {
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/workspace/);

  const firstWorkspace = page
    .locator('a[href^="/workspace/"]:not([href$="/workspace"])')
    .first();
  await firstWorkspace.waitFor({ state: "visible", timeout: 15_000 });
  await firstWorkspace.click();

  const notesTab = page.getByRole("tab", { name: /^notes$/i }).first();
  await notesTab.waitFor({ state: "visible", timeout: 15_000 });
  await notesTab.click();

  const editor = page.locator(".ProseMirror").first();
  if (await editor.isVisible().catch(() => false)) return;

  // State 2: notes exist but none selected. Note rows in the sidebar
  // are divs containing a FileText icon and the note title.
  const firstNoteRow = page.locator("div.group:has(svg.lucide-file-text)").first();
  if (await firstNoteRow.isVisible().catch(() => false)) {
    await firstNoteRow.click();
    await editor.waitFor({ state: "visible", timeout: 15_000 });
    return;
  }

  // State 3: no notes — create one. The "+" icon button in the
  // sidebar header triggers the new-note form; the form has a
  // "Note title" placeholder and a "Create" submit button.
  const newNoteButton = page
    .locator('button:has(svg.lucide-plus)')
    .first();
  await newNoteButton.waitFor({ state: "visible", timeout: 10_000 });
  await newNoteButton.click();
  const titleInput = page.getByPlaceholder(/note title/i).first();
  await titleInput.waitFor({ state: "visible", timeout: 10_000 });
  await titleInput.fill(`regression-${Date.now()}`);
  await page.getByRole("button", { name: /create/i }).first().click();

  await editor.waitFor({ state: "visible", timeout: 15_000 });
}

test.describe("Workspace notes editor — rich-text block styles", () => {
  test.beforeEach(async ({ page }) => {
    await mockNotesAutosave(page);
    await openNotesEditor(page);
  });

  test("H1 toolbar button produces a visibly larger, bolder heading", async ({
    page,
  }) => {
    const editor = page.locator(".ProseMirror").first();
    await editor.click();

    await page.getByRole("button", { name: "Heading 1" }).click();
    await editor.type("heading-one-marker");

    const h1 = editor.locator("h1", { hasText: "heading-one-marker" });
    await expect(h1).toBeVisible();

    const styles = await h1.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        fontSize: parseFloat(cs.fontSize),
        fontWeight: parseInt(cs.fontWeight, 10),
        color: cs.color,
        backgroundColor: cs.backgroundColor,
      };
    });
    // Typography plugin sets h1 to ~2.25em (≥32px on a 16px base) and
    // font-weight ≥700. Without the plugin, preflight resets h1 to
    // `font-size: inherit; font-weight: inherit` which on the editor
    // body would be 16px / 400.
    expect(styles.fontSize).toBeGreaterThan(20);
    expect(styles.fontWeight).toBeGreaterThanOrEqual(700);
    // Regression guard: the platform app always renders dark theme
    // (`<html class="dark">`). Without `dark:prose-invert` on the
    // editor class, the plugin's default light-gray text colors
    // would render invisibly against the #0a0a0a background.
    expect(styles.color).not.toBe(styles.backgroundColor);
  });

  test("H2 toolbar button produces a visibly larger, bolder heading", async ({
    page,
  }) => {
    const editor = page.locator(".ProseMirror").first();
    await editor.click();

    await page.getByRole("button", { name: "Heading 2" }).click();
    await editor.type("heading-two-marker");

    const h2 = editor.locator("h2", { hasText: "heading-two-marker" });
    await expect(h2).toBeVisible();

    const styles = await h2.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return { fontSize: parseFloat(cs.fontSize), fontWeight: parseInt(cs.fontWeight, 10) };
    });
    expect(styles.fontSize).toBeGreaterThan(18);
    expect(styles.fontWeight).toBeGreaterThanOrEqual(600);
  });

  test("H3 toolbar button produces a visibly larger, bolder heading", async ({
    page,
  }) => {
    const editor = page.locator(".ProseMirror").first();
    await editor.click();

    await page.getByRole("button", { name: "Heading 3" }).click();
    await editor.type("heading-three-marker");

    const h3 = editor.locator("h3", { hasText: "heading-three-marker" });
    await expect(h3).toBeVisible();

    const styles = await h3.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return { fontSize: parseFloat(cs.fontSize), fontWeight: parseInt(cs.fontWeight, 10) };
    });
    expect(styles.fontSize).toBeGreaterThan(16);
    expect(styles.fontWeight).toBeGreaterThanOrEqual(600);
  });

  test("Bullet List toolbar button produces a <ul> with visible disc markers", async ({
    page,
  }) => {
    const editor = page.locator(".ProseMirror").first();
    await editor.click();

    await page.getByRole("button", { name: "Bullet List" }).click();
    await editor.type("bullet-marker");

    const ul = editor.locator("ul", { hasText: "bullet-marker" });
    await expect(ul).toBeVisible();

    const listStyleType = await ul.evaluate(
      (el) => window.getComputedStyle(el).listStyleType,
    );
    // Typography plugin sets ul to `list-style-type: disc`. Without
    // the plugin, Tailwind preflight resets it to `none`.
    expect(listStyleType).toBe("disc");
  });

  test("Numbered List toolbar button produces an <ol> with decimal markers", async ({
    page,
  }) => {
    const editor = page.locator(".ProseMirror").first();
    await editor.click();

    await page.getByRole("button", { name: "Numbered List" }).click();
    await editor.type("numbered-marker");

    const ol = editor.locator("ol", { hasText: "numbered-marker" });
    await expect(ol).toBeVisible();

    const listStyleType = await ol.evaluate(
      (el) => window.getComputedStyle(el).listStyleType,
    );
    expect(listStyleType).toBe("decimal");
  });
});
