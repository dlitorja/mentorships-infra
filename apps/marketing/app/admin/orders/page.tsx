"use client";

import { useState, useEffect } from "react";

type PaymentInfo = {
  id: string;
  provider: string;
  providerPaymentId: string;
  amount: string;
  currency: string;
  status: string;
  refundedAmount: string | null;
};

type OrderInfo = {
  id: string;
  userId: string;
  userEmail: string | null;
  userFirstName: string | null;
  status: string;
  provider: string;
  totalAmount: string;
  currency: string;
  createdAt: string;
  payments: PaymentInfo[];
};

type OrdersResponse = {
  items: OrderInfo[];
  total: number;
  page: number;
  pageSize: number;
  error?: string;
};

const REFUND_REASONS = [
  { value: "Duplicate", label: "Duplicate charge" },
  { value: "Fraudulent", label: "Fraudulent" },
  { value: "Requested by customer", label: "Requested by customer" },
  { value: "Other", label: "Other" },
] as const;

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderInfo | null>(null);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundLoading, setRefundLoading] = useState(false);

  // Refund form state
  const [refundType, setRefundType] = useState<"full" | "partial">("full");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState<string>("Requested by customer");
  const [customReason, setCustomReason] = useState("");

  const fetchOrders = async (pageNum: number = 1) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders?page=${pageNum}&pageSize=20`);
      const data: OrdersResponse = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch orders");
      }
      setOrders(data.items);
      setTotal(data.total);
      setPage(data.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch orders");
    } finally {
      setLoading(false);
    }
  };

  // Load orders on mount
  useEffect(() => {
    fetchOrders(1);
  }, []);

  const handleRefundClick = (order: OrderInfo) => {
    setSelectedOrder(order);
    setRefundType("full");
    setRefundAmount("");
    setRefundReason("Requested by customer");
    setCustomReason("");
    setShowRefundModal(true);
  };

  const handleRefundSubmit = async () => {
    if (!selectedOrder) return;

    const payment = selectedOrder.payments[0];
    if (!payment) {
      alert("No payment found for this order");
      return;
    }

    setRefundLoading(true);
    try {
      const res = await fetch("/api/admin/refunds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId: payment.id,
          refundType,
          amount: refundType === "partial" ? refundAmount : undefined,
          reason: refundReason,
          customReason: refundReason === "Other" ? customReason : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to process refund");
      }

      alert("Refund processed successfully!");
      setShowRefundModal(false);
      fetchOrders(page);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to process refund");
    } finally {
      setRefundLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800",
      paid: "bg-green-100 text-green-800",
      refunded: "bg-gray-100 text-gray-800",
      failed: "bg-red-100 text-red-800",
      canceled: "bg-red-100 text-red-800",
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || "bg-gray-100"}`}>
        {status}
      </span>
    );
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Orders</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-8">Loading orders...</div>
      ) : orders.length === 0 ? (
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
                {orders.map((order) => (
                  <tr key={order.id} className="border-b hover:bg-muted/30">
                    <td className="py-3 px-4">
                      <span className="font-mono text-xs">
                        {order.id.slice(0, 8)}...
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-sm">{order.userEmail || "—"}</div>
                      {order.userFirstName && (
                        <div className="text-xs text-muted-foreground">{order.userFirstName}</div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: order.currency?.toUpperCase() || "USD",
                      }).format(parseFloat(order.totalAmount))}
                    </td>
                    <td className="py-3 px-4 capitalize">{order.provider}</td>
                    <td className="py-3 px-4">{getStatusBadge(order.status)}</td>
                    <td className="py-3 px-4 text-sm">
                      {new Date(order.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4">
                      {order.status === "paid" && (
                        <button
                          onClick={() => handleRefundClick(order)}
                          className="text-sm text-red-600 hover:text-red-800 hover:underline"
                        >
                          Refund
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={() => fetchOrders(page - 1)}
                disabled={page === 1}
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => fetchOrders(page + 1)}
                disabled={page >= totalPages}
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Refund Modal */}
      {showRefundModal && selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold mb-4">Process Refund</h2>

            <div className="mb-4">
              <p className="text-sm text-muted-foreground">Order</p>
              <p className="font-mono text-xs">{selectedOrder.id}</p>
            </div>

            <div className="mb-4">
              <p className="text-sm text-muted-foreground">Amount</p>
              <p className="font-medium">
                {new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: selectedOrder.currency?.toUpperCase() || "USD",
                }).format(parseFloat(selectedOrder.totalAmount))}
              </p>
            </div>

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
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  className="w-full px-3 py-2 border rounded"
                  placeholder="0.00"
                />
              </div>
            )}

            <div className="mb-4">
              <label className="block mb-2 font-medium">Reason</label>
              <select
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                className="w-full px-3 py-2 border rounded"
              >
                {REFUND_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            {refundReason === "Other" && (
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

            <div className="flex gap-3">
              <button
                onClick={() => setShowRefundModal(false)}
                className="flex-1 px-4 py-2 border rounded hover:bg-muted"
                disabled={refundLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleRefundSubmit}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                disabled={refundLoading}
              >
                {refundLoading ? "Processing..." : "Process Refund"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}