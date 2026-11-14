import fs from "node:fs";
import path from "node:path";

import { createRouteMatcher } from "@clerk/nextjs/server";
import { describe, expect, it } from "vitest";

import { PROTECTED_ROUTE_PATTERNS } from "@/lib/protected-routes";

/**
 * Regression coverage for the `/instructor/*` 500 (Nov 2026).
 *
 * `proxy.ts` only redirects signed-out visitors to `/sign-in` for paths
 * matched by `PROTECTED_ROUTE_PATTERNS`. A page that calls
 * `requireAuth()` / `requireRole()` but is not matched throws
 * `UnauthorizedError` instead, which Next renders as a 500 "Application
 * error" page — the visitor has no way back into the app, and from their
 * side it looks like login is broken.
 *
 * The discovery test below walks `app/` and fails when a guarded page is
 * not covered, so a newly added authenticated page cannot reintroduce the
 * bug silently.
 */

const APP_DIR = [
  // `pnpm test:unit` runs from the repo root.
  path.resolve(process.cwd(), "apps/platform/app"),
  // ...but tolerate running from `apps/platform`.
  path.resolve(process.cwd(), "app"),
].find((candidate) => fs.existsSync(candidate));

if (!APP_DIR) {
  throw new Error("Could not locate apps/platform/app from the current working directory");
}
const GUARDED_PAGE = /require(?:Role|Auth)\s*\(/;

const isProtectedRoute = createRouteMatcher([...PROTECTED_ROUTE_PATTERNS]);

/** Minimal `NextRequest` stand-in: the matcher only reads `nextUrl.pathname`. */
function request(pathname: string) {
  return { nextUrl: { pathname } } as never;
}

function collectPageFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectPageFiles(entryPath, found);
    } else if (entry.name === "page.tsx") {
      found.push(entryPath);
    }
  }
  return found;
}

/** `app/instructor/dashboard/page.tsx` → `/instructor/dashboard`. */
function toPathname(file: string): string {
  const segments = path
    .relative(APP_DIR, path.dirname(file))
    .split(path.sep)
    .filter(Boolean)
    // Route groups — `(marketing)` — do not appear in the URL.
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
    // Dynamic segments match any value; the concrete value is irrelevant.
    .map((segment) => (segment.startsWith("[") ? "example-id" : segment));

  return `/${segments.join("/")}`;
}

const guardedPages = collectPageFiles(APP_DIR)
  .filter((file) => GUARDED_PAGE.test(fs.readFileSync(file, "utf8")))
  .map(toPathname)
  .sort();

describe("PROTECTED_ROUTE_PATTERNS", () => {
  it("finds the guarded pages it is supposed to check", () => {
    // Guards against the discovery helper silently returning nothing and
    // letting the coverage assertion below pass vacuously.
    expect(guardedPages).toContain("/instructor/dashboard");
    expect(guardedPages.length).toBeGreaterThanOrEqual(10);
  });

  it("covers every page that requires a session", () => {
    const unprotected = guardedPages.filter(
      (pathname) => !isProtectedRoute(request(pathname))
    );

    expect(unprotected).toEqual([]);
  });

  it("covers every instructor page", () => {
    for (const pathname of [
      "/instructor",
      "/instructor/dashboard",
      "/instructor/settings",
      "/instructor/students",
      "/instructor/students/student-id",
      "/instructor/sessions",
      "/instructor/availability",
      "/instructor/onboarding",
      "/instructor/profile",
    ]) {
      expect(isProtectedRoute(request(pathname))).toBe(true);
    }
  });

  it("leaves the public instructor directory open", () => {
    // Broads `(.*)` patterns such as `/instructor(.*)` capture
    // `/instructors` too; that page is public marketing surface.
    expect(isProtectedRoute(request("/instructors"))).toBe(false);
    expect(isProtectedRoute(request("/instructors/example-id"))).toBe(false);
  });

  it("still covers the pre-existing protected areas", () => {
    for (const pathname of [
      "/dashboard",
      "/admin/users",
      "/sessions",
      "/calendar",
      "/settings",
      "/workspace",
      "/api/checkout",
      "/api/sessions",
      "/api/orders",
      "/api/payments",
    ]) {
      expect(isProtectedRoute(request(pathname))).toBe(true);
    }
  });

  it("leaves public pages and API routes open", () => {
    for (const pathname of [
      "/",
      "/sign-in",
      "/sign-up",
      "/auth-redirect",
      "/mentors",
      "/pricing",
      "/api/health",
      "/api/webhooks/clerk",
    ]) {
      expect(isProtectedRoute(request(pathname))).toBe(false);
    }
  });
});
