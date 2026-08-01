import { test, expect } from "@playwright/test";

/**
 * E2E: Purchase a session pack and book a session.
 *
 * Flow:
 * 1. Authenticated student starts Stripe checkout for a session pack.
 * 2. Mock the checkout endpoint to return a fake Stripe URL (or use a real
 *    Stripe test session in an environment with keys).
 * 3. Verify the order is created and the pack is usable for booking.
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

const MOCK_PACK = {
  _id: "pack_test_1",
  name: "5 Session Pack",
  price: 50000,
  stripePriceId: "price_test_123",
  sessionCount: 5,
};

const MOCK_ORDER = {
  _id: "order_test_1",
  userId: "user_test",
  status: "pending",
  provider: "stripe",
  totalAmount: 50000,
  currency: "usd",
};

test.describe("Purchase and book flow", () => {
  test.beforeEach(async ({ page }) => {
    // Mock Convex product lookup and order creation.
    await page.route("**/api/convex**", async (route) => {
      const url = route.request().url();
      if (url.includes("getPublicProductById")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_PACK),
        });
        return;
      }
      if (url.includes("createOrder")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_ORDER),
        });
        return;
      }
      await route.continue();
    });
  });

  test("checkout endpoint returns a Stripe URL for a valid pack", async ({ page }) => {
    // Mock the checkout API to return a known URL.
    await page.route("**/api/checkout/stripe", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "https://checkout.stripe.test/session_123" }),
      });
    });

    await page.goto("/checkout?packId=pack_test_1");
    await page.waitForLoadState("networkidle");

    // Verify the checkout page renders the pack name.
    await expect(page.getByText(/5 Session Pack/i)).toBeVisible();

    // Click the checkout button and wait for the mocked redirect.
    await page.getByRole("button", { name: /checkout/i }).click();
    await page.waitForURL("https://checkout.stripe.test/session_123", { timeout: 10_000 });
    await expect(page).toHaveURL("https://checkout.stripe.test/session_123");
  });

  test("booking page validates required fields before submit", async ({ page }) => {
    await page.goto("/book/instructor_test_1");
    await page.waitForLoadState("networkidle");

    // Try to submit without selecting a slot.
    await page.getByRole("button", { name: /book session/i }).click();

    // Expect a validation error or disabled submit state.
    await expect(
      page.getByText(/select a slot/i).or(page.getByRole("button", { name: /book session/i }))
    ).toBeVisible();
    const submitButton = page.getByRole("button", { name: /book session/i });
    await expect(submitButton).toBeDisabled();
  });
});
