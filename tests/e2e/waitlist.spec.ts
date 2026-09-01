import { test, expect, beforeEach } from "./helpers/kernel-browser";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

const TEST_INSTRUCTOR_SLUG = "test-instructor-waitlist";

const createdEmails = new Set<string>();

test.afterAll(async (): Promise<void> => {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
  if (!convexUrl) {
    console.error("Missing Convex URL for cleanup");
    return;
  }

  const convex = new ConvexHttpClient(convexUrl);
  for (const email of createdEmails) {
    try {
      await convex.mutation(api.waitlist.removeByEmail, {
        email,
        instructorSlug: TEST_INSTRUCTOR_SLUG,
      });
    } catch (error) {
      console.error(`Failed to cleanup waitlist entry for ${email}:`, error);
    }
  }
});

test.describe("Waitlist Functionality", () => {
  beforeEach(async ({ kernelPage }): Promise<void> => {
    await kernelPage.goto(`/instructors/${TEST_INSTRUCTOR_SLUG}`);
    await kernelPage.waitForLoadState("networkidle");
  });

  test("should display Sold Out button when inventory is 0", async ({ kernelPage }): Promise<void> => {
    const soldOutButton = kernelPage.locator("button:has-text('Sold Out')");
    await expect(soldOutButton).toBeVisible({ timeout: 10000 });
  });

  test("should show Join Waitlist button when sold out", async ({ kernelPage }): Promise<void> => {
    const joinWaitlistButton = kernelPage.locator("button:has-text('Join Waitlist')");
    await expect(joinWaitlistButton).toBeVisible({ timeout: 10000 });
  });

  test("should open waitlist form when Join Waitlist is clicked", async ({ kernelPage }): Promise<void> => {
    await kernelPage.click("button:has-text('Join Waitlist')");
    const emailInput = kernelPage.locator('input[type="email"]');
    await expect(emailInput).toBeVisible();
  });

  test("should add user to waitlist on valid email submission", async ({ kernelPage }): Promise<void> => {
    const uniqueEmail = `test+waitlist${Date.now()}@example.com`;
    createdEmails.add(uniqueEmail);

    await kernelPage.click("button:has-text('Join Waitlist')");
    await kernelPage.fill('input[type="email"]', uniqueEmail);
    await kernelPage.click("button:has-text('Join')");

    await expect(kernelPage.locator("text=You're on the list!")).toBeVisible({ timeout: 10000 });
  });

  test("should handle duplicate email gracefully", async ({ kernelPage }): Promise<void> => {
    const duplicateEmail = `test+duplicate${Date.now()}@example.com`;
    createdEmails.add(duplicateEmail);

    await kernelPage.click("button:has-text('Join Waitlist')");
    await kernelPage.fill('input[type="email"]', duplicateEmail);
    await kernelPage.click("button:has-text('Join')");

    await expect(kernelPage.locator("text=You're on the list!")).toBeVisible({ timeout: 10000 });

    await kernelPage.goto(`/instructors/${TEST_INSTRUCTOR_SLUG}`);
    await kernelPage.waitForLoadState("networkidle");

    await kernelPage.click("button:has-text('Join Waitlist')");
    await kernelPage.fill('input[type="email"]', duplicateEmail);
    await kernelPage.click("button:has-text('Join')");

    await expect(kernelPage.locator("text=already on the waitlist")).toBeVisible({ timeout: 10000 });
  });

  test("should allow canceling waitlist form", async ({ kernelPage }): Promise<void> => {
    await kernelPage.click("button:has-text('Join Waitlist')");
    await expect(kernelPage.locator('input[type="email"]')).toBeVisible();

    await kernelPage.click("button:has-text('Cancel')");
    await expect(kernelPage.locator('input[type="email"]')).not.toBeVisible();
  });

  test("should show success message then close and reopen", async ({ kernelPage }): Promise<void> => {
    const email = `test+success${Date.now()}@example.com`;
    createdEmails.add(email);

    await kernelPage.click("button:has-text('Join Waitlist')");
    await kernelPage.fill('input[type="email"]', email);
    await kernelPage.click("button:has-text('Join')");

    await expect(kernelPage.locator("text=You're on the list!")).toBeVisible({ timeout: 10000 });

    await kernelPage.click("button:has-text('Close')");
    await expect(kernelPage.locator("text=You're on the list!")).not.toBeVisible();

    await kernelPage.click("button:has-text('Join Waitlist')");
    await expect(kernelPage.locator('input[type="email"]')).toBeVisible();
  });

  test("should navigate to instructor page and display profile", async ({ kernelPage }): Promise<void> => {
    await expect(kernelPage.locator("h1:has-text('Test Instructor')")).toBeVisible({ timeout: 10000 });
    await expect(kernelPage.locator("text=TEST INSTRUCTOR - Hidden for waitlist testing")).toBeVisible();
  });
});

