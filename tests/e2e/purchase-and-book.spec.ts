import { test, expect } from "@playwright/test";

/**
 * E2E: Purchase a session pack and book a session.
 *
 * The public instructor profile is at `/instructors/[slug]` and links to the
 * checkout route. The booking page is `/calendar`, which requires the student
 * to have an active session pack.
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

const MOCK_INSTRUCTOR = {
  _id: "instructor_test_1",
  instructorId: "instructor_test_1",
  slug: "test-instructor",
  name: "Test Instructor",
  tagline: "Learn with Test",
  bio: "A test instructor for E2E specs.",
  specialties: [],
  background: [],
  socials: [],
  portfolioImages: [],
  isActive: true,
  oneOnOneInventory: 5,
  groupInventory: 5,
  profileImageUrl: null,
};

const MOCK_PRODUCT = {
  _id: "product_test_1",
  active: true,
  mentorshipType: "one-on-one",
  price: 500,
  sessionsPerPack: 5,
  stripePriceId: "price_test_123",
};

const MOCK_PACK = {
  _id: "pack_test_1",
  instructorId: "instructor_test_1",
  remainingSessions: 5,
  expiresAt: null,
  status: "active",
};

test.describe("Purchase and book flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/convex**", async (route) => {
      const url = route.request().url();
      if (url.includes("getInstructorBySlug")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_INSTRUCTOR),
        });
        return;
      }
      if (url.includes("getProductsByInstructor") || url.includes("getPublicActiveProducts")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            page: [MOCK_PRODUCT],
            continueCursor: null,
            isDone: true,
          }),
        });
        return;
      }
      if (url.includes("getCurrentUser")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            timeZone: "America/New_York",
          }),
        });
        return;
      }
      if (url.includes("getUserActiveSessionPacks")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            page: [MOCK_PACK],
            continueCursor: null,
            isDone: true,
          }),
        });
        return;
      }
      if (url.includes("getUpcomingSessions")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            page: [],
            continueCursor: null,
            isDone: true,
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.route("**/api/checkout/stripe", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "https://checkout.stripe.test/session_123" }),
      });
    });
  });

  test("instructor profile links to checkout for a 1-on-1 pack", async ({ page }) => {
    await page.goto("/instructors/test-instructor");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: MOCK_INSTRUCTOR.name })).toBeVisible();
    await expect(page.getByText("1-on-1 Mentorships:")).toBeVisible();

    const buyButton = page.getByRole("link", { name: "Buy 1-on-1 pack" });
    await expect(buyButton).toHaveAttribute(
      "href",
      "/checkout?instructor=test-instructor&type=one-on-one"
    );
  });

  test("checkout endpoint redirects to Stripe for a valid pack", async ({ page }) => {
    await page.goto("/checkout?instructor=test-instructor&type=one-on-one");
    await page.waitForLoadState("networkidle");

    await page.waitForURL("https://checkout.stripe.test/session_123", { timeout: 10_000 });
    await expect(page).toHaveURL("https://checkout.stripe.test/session_123");
  });

  test("calendar page renders booking form when active packs exist", async ({ page }) => {
    await page.goto("/calendar");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
    await expect(page.getByText("Active Session Packs")).toBeVisible();
    await expect(page.getByText("5 sessions remaining")).toBeVisible();
  });
});
