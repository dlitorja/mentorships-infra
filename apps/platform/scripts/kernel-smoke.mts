/**
 * Smoke test for the Kernel browser fixture.
 * Verifies end-to-end: SDK -> cloud browser -> CDP -> Playwright page -> navigate -> cleanup.
 * Not part of the regular test suite; run on demand:
 *   KERNEL_API_KEY=... node --experimental-strip-types scripts/kernel-smoke.mts
 */
import { chromium } from "@playwright/test";
import Kernel from "@onkernel/sdk";

async function main(): Promise<void> {
  if (!process.env.KERNEL_API_KEY) {
    throw new Error("KERNEL_API_KEY is required");
  }

  const kernel = new Kernel({ apiKey: process.env.KERNEL_API_KEY });
  const browser = await kernel.browsers.create({ stealth: true });
  console.log(`Created Kernel browser session: ${browser.session_id}`);
  console.log(`Live view: ${browser.browser_live_view_url}`);

  try {
    const connected = await chromium.connectOverCDP(browser.cdp_ws_url);
    console.log("Connected Playwright via CDP");

    const context = await connected.newContext();
    const page = await context.newPage();

    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    const title = await page.title();
    console.log(`example.com title: ${title}`);

    await context.close();
    await connected.close();
  } finally {
    await kernel.browsers.deleteByID(browser.session_id);
    console.log(`Deleted Kernel browser session: ${browser.session_id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
