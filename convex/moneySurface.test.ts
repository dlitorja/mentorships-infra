/// <reference types="vite/client" />
import { expect, test } from "vitest";
import * as payments from "./payments";
import * as sessionPacks from "./sessionPacks";
import * as orders from "./orders";

/**
 * Wave 1 (HUC-116) regression guard — money writers.
 *
 * Wave 1a internalized the dead writers (no live callers). Wave 1b moves the
 * live money writers behind internal mutations + bearer HTTP endpoints, and
 * the narrow follow-up removes the temporary public wrappers entirely.
 *
 * Same visibility-metadata pattern as `migrationSurface.test.ts`: the Convex
 * runtime stamps `isInternal` / `isPublic` on every registered function, so a
 * future edit cannot silently re-expose one.
 */

type Visibility = { isInternal?: boolean; isPublic?: boolean };

const INTERNAL_ONLY: ReadonlyArray<readonly [string, string, Visibility]> = [
  ["payments", "createPaymentInternal", payments.createPaymentInternal as Visibility],
  ["payments", "refundPaymentInternal", payments.refundPaymentInternal as Visibility],
  ["sessionPacks", "createSessionPackInternal", sessionPacks.createSessionPackInternal as Visibility],
  ["sessionPacks", "refundSessionPackInternal", sessionPacks.refundSessionPackInternal as Visibility],
  ["orders", "createOrderInternal", orders.createOrderInternal as Visibility],
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

test("wave 1b public money wrappers are removed", () => {
  expect("createPayment" in payments).toBe(false);
  expect("refundPayment" in payments).toBe(false);
  expect("createSessionPack" in sessionPacks).toBe(false);
  expect("refundSessionPack" in sessionPacks).toBe(false);
  expect("createOrder" in orders).toBe(false);
});
