"use client";

import { useState, useCallback } from "react";
import {
  type AdminOrder,
  type RefundReason,
  formatMoney,
  remainingRefundable,
  useOrdersForAdmin,
  useProcessRefundForAdmin,
} from "@/lib/queries/convex";

const REFUND_REASONS: { value: RefundReason; label: string }[] = [
  { value: "Duplicate", label: "Duplicate charge" },
  { value: "Fraudulent", label: "Fraudulent" },
  { value: "Requested by customer", label: "Requested by customer" },
  { value: "Other", label: "Other" },
];

const STATUS_FILTERS: { value: AdminOrder["status"] | ""; label: string }[] = [
  { value: "", label: "All Status" },
  { value: "paid", label: "Paid" },
  { value: "pending", label: "Pending" },
  { value: "refunded", label: "Refunded" },
  { value: "failed", label: "Failed" },
  { value: "canceled", label: "Canceled" },
];

function statusBadge(status: string): React.ReactNode {
  const styles: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    paid: "bg-green-100 text-green-800",
    completed: "bg-green-100 text-green-800",
    refunded: "bg-gray-100 text-gray-800",
    failed: "bg-red-100 text-red-800",
    canceled: "bg-red-100 text-red-800",
  };
  return (
    <span
      className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] ?? "bg-gray-100"}`}
    >
      {status}
    </span>
  );
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function RefundModal({
  order,
  onClose,
  onSuccess,
}: {
  order: AdminOrder;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const processRefund = useProcessRefundForAdmin();
  const payment = order.payments[0];
  const [refundType, setRefundType] = useState<"full" | "partial">("full");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<RefundReason>("Requested by customer");
  const [customReason, setCustomReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const max = payment ? remainingRefundable(payment) : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payment) {
      setError("No payment found for this order");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await processRefund({
        paymentId: payment.id,
        refundType,
        amount: refundType === "partial" ? amount : undefined,
        reason,
        customReason: reason === "Other" ? customReason : undefined,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process refund");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-bold mb-4">Process Refund</h2>

        <div className="mb-4">
          <p className="text-sm text-muted-foreground">Order</p>
          <p className="font-mono text-xs">{order.id}</p>
        </div>

        <div className="mb-4">
          <p className="text-sm text-muted-foreground">Amount</p>
          <p className="font-medium">
            {formatMoney(order.totalAmount, order.currency)}
          </p>
          {payment && payment.refundedAmount && parseFloat(payment.refundedAmount) > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Previously refunded: {formatMoney(payment.refundedAmount, payment.currency)}
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block mb-2 font-medium">Refund Type</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="refundType"
                  checked={refundType === "full"}
                  onChange={() => setRefundType("full")}
                />
                Full
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="refundType"
                  checked={refundType === "partial"}
                  onChange={() => setRefundType("partial")}
                />
                Partial
              </label>
            </div>
          </div>

          {refundType === "partial" && (
            <div className="mb-4">
              <label className="block mb-2 font-medium">Refund Amount</label>
              <input
                type="number"
                step="0.01"
                max={max}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3 py-2 border rounded"
                placeholder={`Max: ${max.toFixed(2)}`}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Maximum refundable: {formatMoney(max.toString(), order.currency)}
              </p>
            </div>
          )}

          <div className="mb-4">
            <label className="block mb-2 font-medium">Reason</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as RefundReason)}
              className="w-full px-3 py-2 border rounded"
            >
              {REFUND_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {reason === "Other" && (
            <div className="mb-4">
              <label className="block mb-2 font-medium">Custom Reason</label>
              <textarea
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                className="w-full px-3 py-2 border rounded"
                rows={3}
                placeholder="Enter reason..."
              />
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded mb-4 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border rounded hover:bg-muted"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? "Processing..." : "Process Refund"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function OrdersTable() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AdminOrder["status"] | "">("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<AdminOrder | null>(null);

  const { data, isLoading, error, canLoadMore, loadMore } = useOrdersForAdmin({
    search: appliedSearch || undefined,
    statusFilter: statusFilter || undefined,
    pageSize: appliedSearch ? 500 : 50,
  });

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setAppliedSearch(search.trim());
  }, [search]);

  // Client-side refinement when search is active: filter by email or
  // order ID prefix. Server already returned a 500-row window.
  const visibleOrders =
    appliedSearch && appliedSearch.length > 0
      ? data.filter((o) => {
          const s = appliedSearch.toLowerCase();
          return (
            (o.userEmail?.toLowerCase().includes(s) ?? false) ||
            o.id.toLowerCase().includes(s) ||
            (o.userFirstName?.toLowerCase().includes(s) ?? false)
          );
        })
      : data;

  return (
    <>
      <div className="flex flex-wrap gap-4 mb-4">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1 max-w-md">
          <input
            type="text"
            placeholder="Search by email, name, or order ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-3 py-2 border rounded"
          />
          <button
            type="submit"
            className="px-4 py-2 border rounded bg-secondary hover:bg-secondary/80"
          >
            Search
          </button>
        </form>

        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as AdminOrder["status"] | "")
          }
          className="px-3 py-2 border rounded w-[180px]"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded mb-4">
          {error instanceof Error ? error.message : "Failed to load orders"}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8">Loading orders...</div>
      ) : visibleOrders.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">No orders found</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">Order ID</th>
                  <th className="text-left py-3 px-4 font-medium">Customer</th>
                  <th className="text-left py-3 px-4 font-medium">Amount</th>
                  <th className="text-left py-3 px-4 font-medium">Provider</th>
                  <th className="text-left py-3 px-4 font-medium">Status</th>
                  <th className="text-left py-3 px-4 font-medium">Date</th>
                  <th className="text-left py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((order) => {
                  const payment = order.payments[0];
                  return (
                    <tr key={order.id} className="border-b hover:bg-muted/30">
                      <td className="py-3 px-4">
                        <span className="font-mono text-xs">
                          {order.id.slice(0, 8)}...
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-sm">{order.userEmail || "—"}</div>
                        {order.userFirstName && (
                          <div className="text-xs text-muted-foreground">
                            {order.userFirstName}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {formatMoney(order.totalAmount, order.currency)}
                        {payment &&
                          payment.refundedAmount &&
                          parseFloat(payment.refundedAmount) > 0 && (
                            <div className="text-xs text-muted-foreground">
                              refunded {formatMoney(payment.refundedAmount, payment.currency)}
                            </div>
                          )}
                      </td>
                      <td className="py-3 px-4 capitalize">{order.provider}</td>
                      <td className="py-3 px-4">{statusBadge(order.status)}</td>
                      <td className="py-3 px-4 text-sm">{formatDate(order.createdAt)}</td>
                      <td className="py-3 px-4">
                        {order.status === "paid" && payment && (
                          <button
                            onClick={() => setSelectedOrder(order)}
                            className="text-sm text-red-600 hover:text-red-800 hover:underline"
                          >
                            Refund
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {canLoadMore && (
            <div className="flex items-center justify-center mt-4">
              <button
                onClick={() => loadMore(50)}
                className="px-4 py-2 border rounded hover:bg-muted"
              >
                Load more
              </button>
            </div>
          )}
        </>
      )}

      {selectedOrder && (
        <RefundModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onSuccess={() => setSelectedOrder(null)}
        />
      )}
    </>
  );
}
