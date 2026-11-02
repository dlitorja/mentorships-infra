/// <reference types="vite/client" />
import { expect, test } from "vitest";
import * as payments from "./payments";
import * as sessionPacks from "./sessionPacks";

/**
 * Wave 1 (HUC-116) regression guard — dead money writers.
 *
 * These functions had no live callers (only unused client hooks), but were
 * still public Convex mutations: anyone holding `NEXT_PUBLIC_CONVEX_URL`
 * could call them. They are now `internalMutation`, so `api.<module>.<fn>`
 * stops typechecking and the callable surface is closed.
 *
 * Same visibility-metadata pattern as `migrationSurface.test.ts`: the Convex
 * runtime stamps `isInternal` / `isPublic` on every registered function, so a
 * future edit cannot silently re-expose one.
 */

type Visibility = { isInternal?: boolean; isPublic?: boolean };

const INTERNAL_ONLY: ReadonlyArray<readonly [string, string, Visibility]> = [
  ["payments", "updatePayment", payments.updatePayment as Visibility],
  ["payments", "completePayment", payments.completePayment as Visibility],
  ["payments", "failPayment", payments.failPayment as Visibility],
  ["payments", "deletePayment", payments.deletePayment as Visibility],
  ["sessionPacks", "updateSessionPack", sessionPacks.updateSessionPack as Visibility],
  ["sessionPacks", "useSession", sessionPacks.useSession as Visibility],
  ["sessionPacks", "expireSessionPack", sessionPacks.expireSessionPack as Visibility],
  [
    "sessionPacks",
    "processExpiredSessionPacks",
    sessionPacks.processExpiredSessionPacks as Visibility,
  ],
  ["sessionPacks", "deleteSessionPack", sessionPacks.deleteSessionPack as Visibility],
];

test("wave 1 dead money writers are internal-only", () => {
  for (const [moduleName, functionName, visibility] of INTERNAL_ONLY) {
    const label = `${moduleName}.${functionName}`;
    expect(visibility.isInternal, `${label} must be internalMutation`).toBe(true);
    expect(visibility.isPublic, `${label} must not be public`).not.toBe(true);
  }
});
