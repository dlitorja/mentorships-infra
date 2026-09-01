/**
 * Playwright fixture that boots a cloud Chromium via the Kernel SDK
 * and returns a Page connected to it over CDP.
 *
 * - Reads `KERNEL_API_KEY` from env (Vercel Marketplace integration
 *   auto-provisions this).
 * - One browser per test; deleted on teardown to avoid billing drift.
 * - Uses stealth by default so the same patterns hold up against
 *   bot-detection if the spec is later extended.
 *
 * Switch a spec to Kernel by importing `test`/`expect` from this
 * file and using the `kernelPage` fixture instead of `page`.
 */
/* eslint-disable react-hooks/rules-of-hooks, no-empty-pattern */
import {
  test as base,
  expect,
  chromium,
  beforeEach,
  type Page,
} from "@playwright/test";
import Kernel from "@onkernel/sdk";

type KernelFixtures = {
  kernelPage: Page;
};

export const test = base.extend<KernelFixtures>({
  kernelPage: async ({}, use): Promise<void> => {
    const apiKey = process.env.KERNEL_API_KEY;
    if (!apiKey) {
      throw new Error(
        "KERNEL_API_KEY is required for kernel-* projects. " +
          "Provision via the Vercel Marketplace integration or set it locally."
      );
    }

    const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL;
    if (!baseURL) {
      throw new Error(
        "PLAYWRIGHT_TEST_BASE_URL is required for kernel-* projects and " +
          "must point at a deployment reachable by the remote Kernel browser. " +
          "Kernel browsers cannot reach localhost:3000 on the test runner."
      );
    }

    const kernel = new Kernel({ apiKey });
    const browser = await kernel.browsers.create({ stealth: true });

    try {
      const connected = await chromium.connectOverCDP(browser.cdp_ws_url);
      const context = await connected.newContext({ baseURL });
      const page = await context.newPage();
      try {
        await use(page);
      } finally {
        await context.close();
        await connected.close();
      }
    } finally {
      await kernel.browsers.deleteByID(browser.session_id);
    }
  },
});

export { expect, beforeEach };


