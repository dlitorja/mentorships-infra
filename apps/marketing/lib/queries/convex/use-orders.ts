"use client";

import { useState, useCallback } from "react";
import { useQueries } from "@tanstack/react-query";
import { convexQuery, useConvexAction } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * PR admin-mirror #5: hook layer for the marketing /admin/orders
 * page. Mirrors `apps/marketing/lib/queries/convex/use-instructors.ts`
 * shape (per-cursor reactive subscriptions via `useQueries` +
 * `cursorChain`). The marketing page was previously broken: it
 * called `fetch('/api/admin/orders')` and `fetch('/api/admin/refunds')`
 * which DO NOT exist in the marketing app. PR 5 swaps both calls
 * for Convex — a cursor-paginated query and a refund action that
 * gates on the admin role and proxies to Stripe / PayPal.
 */

export type AdminOrderPayment = {
  id: Id<"payments">;
  provider: "stripe" | "paypal";
  providerPaymentId: string;
  amount: string;
  currency: string;
  status: "pending" | "completed" | "refunded" | "failed";
  refundedAmount: string | null;
};

export type AdminOrder = {
  id: Id<"orders">;
  userId: string;
  userEmail: string | null;
  userFirstName: string | null;
  status: "pending" | "paid" | "refunded" | "failed" | "canceled";
  provider: "stripe" | "paypal";
  totalAmount: string;
  currency: string;
  createdAt: number;
  payments: AdminOrderPayment[];
};

export type RefundReason =
  | "Duplicate"
  | "Fraudulent"
  | "Requested by customer"
  | "Other";

/**
 * Cursor-paginated orders list for the admin table.
 *
 * `search` widens `numItems` to 500 so a single round-trip can fetch
 * a large window that the client filters locally by email or order
 * ID prefix. Without `search` it uses 50 rows per page.
 *
 * Each loaded cursor becomes its own Convex subscription via
 * `useQueries` so reactive updates to ANY previously-loaded page
 * propagate to the rendered list (matches the PR 4 instructor
 * pattern).
 */
export function useOrdersForAdmin(args: {
  search?: string;
  statusFilter?: AdminOrder["status"];
  pageSize?: number;
}) {
  const isSearch = !!args.search && args.search.trim().length > 0;
  const numItems = args.pageSize ?? (isSearch ? 500 : 50);
  const [cursorChain, setCursorChain] = useState<Array<string | null>>([null]);
  const [lastSeenArgsKey, setLastSeenArgsKey] = useState(
    JSON.stringify({ search: args.search ?? null, statusFilter: args.statusFilter ?? null })
  );

  const argsKey = JSON.stringify({
    search: args.search ?? null,
    statusFilter: args.statusFilter ?? null,
  });

  if (lastSeenArgsKey !== argsKey) {
    setLastSeenArgsKey(argsKey);
    setCursorChain([null]);
  }

  const results = useQueries({
    queries: cursorChain.map((cursor) =>
      convexQuery(api.admin.getOrdersForAdminCursor, {
        search: args.search,
        statusFilter: args.statusFilter,
        paginationOpts: { numItems, cursor },
      })
    ),
  });

  const accumulated: AdminOrder[] = [];
  let firstError: unknown = null;
  let isFirstPageLoading = false;
  let lastIsDone = true;
  let lastContinueCursor: string | null = null;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.error) firstError = firstError ?? r.error;
    if (i === 0 && r.isLoading) isFirstPageLoading = true;
    if (r.data) {
      accumulated.push(...r.data.page);
      lastIsDone = r.data.isDone;
      lastContinueCursor = r.data.continueCursor;
    }
  }

  const loadMore = useCallback(
    (_n: number) => {
      if (!lastIsDone && lastContinueCursor != null) {
        if (!cursorChain.includes(lastContinueCursor)) {
          setCursorChain((prev) => [...prev, lastContinueCursor]);
        }
      }
    },
    [lastIsDone, lastContinueCursor, cursorChain]
  );

  return {
    data: accumulated,
    isLoading: isFirstPageLoading && accumulated.length === 0,
    isFetchingMore: isFirstPageLoading && accumulated.length > 0,
    error: firstError,
    canLoadMore: !lastIsDone && !isFirstPageLoading,
    loadMore,
  };
}

/**
 * Process a full or partial refund for a payment. Wraps
 * `convex/adminRefunds.ts:processRefundForAdmin` (a public action
 * that calls Stripe / PayPal, updates the payment + order, and
 * sends the student a refund email). The action self-gates on
 * admin via `internal.admin.isAdmin`.
 *
 * The caller MUST supply a stable `nonce` per "refund attempt session"
 * (typically generated when the modal opens). If the action throws
 * after the provider accepted the refund, retrying with the same
 * nonce dedupes at the provider and the local DB update commits the
 * recorded amount. A new nonce would issue a second provider refund.
 */
export function useProcessRefundForAdmin() {
  return useConvexAction(api.adminRefunds.processRefundForAdmin);
}

/**
 * Format a money string like "12.34" as USD (or other currency).
 * Mirrors the helper inline in the previous marketing page.
 */
export function formatMoney(amount: string, currency: string = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(parseFloat(amount));
}

/**
 * Compute the remaining refundable amount for a payment.
 * `originalAmount - refundedAmount` (floored at 0).
 */
export function remainingRefundable(payment: AdminOrderPayment): number {
  const original = parseFloat(payment.amount);
  const refunded = payment.refundedAmount ? parseFloat(payment.refundedAmount) : 0;
  return Math.max(original - refunded, 0);
}
