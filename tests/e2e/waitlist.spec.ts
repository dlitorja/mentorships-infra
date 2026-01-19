import { test, expect, beforeEach, afterAll } from "@playwright/test";

const TEST_INSTRUCTOR_SLUG = "test-instructor-waitlist";

test.describe("Waitlist Functionality", () => {
  beforeEach(async ({ page }) => {
    await page.goto(`/instructors/${TEST_INSTRUCTOR_SLUG}`);
    await page.waitForLoadState("networkidle");
  });

  test("should display Sold Out button when inventory is 0", async ({ page }) => {
    const soldOutButton = page.locator("button:has-text('Sold Out')");
    await expect(soldOutButton).toBeVisible({ timeout: 10000 });
  });

  test("should show Join Waitlist button when sold out", async ({ page }) => {
    const joinWaitlistButton = page.locator("button:has-text('Join Waitlist')");
    await expect(joinWaitlistButton).toBeVisible({ timeout: 10000 });
  });

  test("should open waitlist form when Join Waitlist is clicked", async ({ page }) => {
    await page.click("button:has-text('Join Waitlist')");
    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toBeVisible();
  });

  test("should add user to waitlist on valid email submission", async ({ page }) => {
    const uniqueEmail = `test+waitlist${Date.now()}@example.com`;

    await page.click("button:has-text('Join Waitlist')");
    await page.fill('input[type="email"]', uniqueEmail);
    await page.click("button:has-text('Join')");

    await expect(page.locator("text=You're on the list!")).toBeVisible({ timeout: 10000 });
  });

  test("should handle duplicate email gracefully", async ({ page }) => {
    const duplicateEmail = "duplicate@test.com";

    await page.click("button:has-text('Join Waitlist')");
    await page.fill('input[type="email"]', duplicateEmail);
    await page.click("button:has-text('Join')");

    await expect(page.locator("text=You're on the list!")).toBeVisible({ timeout: 10000 });

    await page.goto(`/instructors/${TEST_INSTRUCTOR_SLUG}`);
    await page.waitForLoadState("networkidle");

    await page.click("button:has-text('Join Waitlist')");
    await page.fill('input[type="email"]', duplicateEmail);
    await page.click("button:has-text('Join')");

    await expect(page.locator("text=already on the waitlist")).toBeVisible({ timeout: 10000 });
  });

  test("should allow canceling waitlist form", async ({ page }) => {
    await page.click("button:has-text('Join Waitlist')");
    await expect(page.locator('input[type="email"]')).toBeVisible();

    await page.click("button:has-text('Cancel')");
    await expect(page.locator('input[type="email"]')).not.toBeVisible();
  });

  test("should show success message then close and reopen", async ({ page }) => {
    await page.click("button:has-text('Join Waitlist')");
    await page.fill('input[type="email"]', "test@example.com");
    await page.click("button:has-text('Join')");

    await expect(page.locator("text=You're on the list!")).toBeVisible({ timeout: 10000 });

    await page.click("button:has-text('Close')");
    await expect(page.locator("text=You're on the list!")).not.toBeVisible();

    await page.click("button:has-text('Join Waitlist')");
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test("should navigate to instructor page and display profile", async ({ page }) => {
    await expect(page.locator("h1:has-text('Test Instructor')")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=TEST INSTRUCTOR - Hidden for waitlist testing")).toBeVisible();
  });
});

test.afterAll(async () => {
  const cleanupUrl = process.env.PLAYWRIGHT_TEST_BASE_URL
    ? `${process.env.PLAYWRIGHT_TEST_BASE_URL}/api/admin/waitlist-cleanup?instructor=${TEST_INSTRUCTOR_SLUG}`
    : `http://localhost:3000/api/admin/waitlist-cleanup?instructor=${TEST_INSTRUCTOR_SLUG}`;

  try {
    await fetch(cleanupUrl, { method: "DELETE" });
  } catch (error) {
    console.error("Failed to cleanup test data:", error);
  }
});
