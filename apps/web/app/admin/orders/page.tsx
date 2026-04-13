"use client";

import { useState, useEffect } from "react";
import { redirect } from "next/navigation";
import { 
  Search,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Copy
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

type Order = {
  id: string;
  userId: string;
  userEmail: string | null;
  status: string;
  provider: string;
  totalAmount: string;
  currency: string;
  createdAt: string;
  payments: {
    id: string;
    provider: string;
    providerPaymentId: string;
    amount: string;
    currency: string;
    status: string;
    refundedAmount: string | null;
  }[];
};

type OrdersResponse = {
  items: Order[];
  total: number;
  page: number;
  pageSize: number;
};

function formatCurrency(amount: string, currency: string = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(parseFloat(amount));
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "paid":
    case "completed":
      return "default";
    case "pending":
      return "secondary";
    case "refunded":
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

function RefundModal({ 
  order, 
  onClose, 
  onSuccess 
}: { 
  order: Order;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [refundType, setRefundType] = useState<"full" | "partial">("full");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("Requested by customer");
  const [customReason, setCustomReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const payment = order.payments[0];
  const maxRefund = payment 
    ? parseFloat(payment.amount) - parseFloat(payment.refundedAmount || "0")
    : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/refunds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId: payment.id,
          refundType,
          amount: refundType === "partial" ? amount : undefined,
          reason,
          customReason: reason === "Other" ? customReason : undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to process refund");
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process refund");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-lg p-6 max-w-md w-full mx-4 space-y-4">
        <h2 className="text-xl font-bold">Process Refund</h2>
        <p className="text-muted-foreground text-sm">
          Order ID: {order.id.slice(0, 8)}... | Amount: {formatCurrency(order.totalAmount, order.currency)}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Refund Type</label>
            <div className="flex gap-4 mt-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="refundType"
                  value="full"
                  checked={refundType === "full"}
                  onChange={() => setRefundType("full")}
                />
                Full Refund
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="refundType"
                  value="partial"
                  checked={refundType === "partial"}
                  onChange={() => setRefundType("partial")}
                />
                Partial Refund
              </label>
            </div>
          </div>

          {refundType === "partial" && (
            <div>
              <label className="text-sm font-medium">Amount</label>
              <Input
                type="number"
                step="0.01"
                max={maxRefund}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={`Max: ${maxRefund.toFixed(2)}`}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Maximum refundable: {formatCurrency(maxRefund.toString(), order.currency)}
              </p>
            </div>
          )}

          <div>
            <label className="text-sm font-medium">Reason</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full mt-1 p-2 border rounded-md"
            >
              <option value="Duplicate">Duplicate</option>
              <option value="Fraudulent">Fraudulent</option>
              <option value="Requested by customer">Requested by customer</option>
              <option value="Other">Other</option>
            </select>
          </div>

          {reason === "Other" && (
            <div>
              <label className="text-sm font-medium">Custom Reason</label>
              <Input
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Enter reason..."
                className="mt-1"
              />
            </div>
          )}

          {error && (
            <div className="text-red-500 text-sm">{error}</div>
          )}

          <div className="flex gap-4 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Processing..." : "Process Refund"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("pageSize", pageSize.toString());
      if (statusFilter) params.set("status", statusFilter);

      const res = await fetch(`/api/admin/orders?${params}`);
      
      if (!res.ok) {
        console.error("Auth check failed - not authorized");
        redirect("/dashboard?error=unauthorized");
        return;
      }

      const data: OrdersResponse = await res.json();

      setOrders(data.items);
      setTotal(data.total);
    } catch (error) {
      console.error("Error fetching orders:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [page, statusFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  };

  const filteredOrders = search
    ? orders.filter(
        (o) =>
          o.userEmail?.toLowerCase().includes(search.toLowerCase()) ||
          o.id.toLowerCase().includes(search.toLowerCase())
      )
    : orders;

  const handleRefundSuccess = () => {
    setSelectedOrder(null);
    fetchOrders();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Orders</h1>
        <p className="text-muted-foreground mt-1">
          View and manage orders, process refunds
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <form onSubmit={handleSearch} className="flex gap-2 flex-1 max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search by email or order ID..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button type="submit" variant="secondary">Search</Button>
            </form>

            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="p-2 border rounded-md"
            >
              <option value="">All Status</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="refunded">Refunded</option>
              <option value="failed">Failed</option>
            </select>

            <Button 
              variant="outline" 
              onClick={() => {
                setRefreshing(true);
                fetchOrders().finally(() => setRefreshing(false));
              }}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Orders Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground mb-2">No orders yet</p>
              <p className="text-sm text-muted-foreground">
                Orders will appear when customers make purchases
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium">Order ID</th>
                    <th className="text-left py-3 px-4 font-medium">Customer</th>
                    <th className="text-left py-3 px-4 font-medium">Amount</th>
                    <th className="text-left py-3 px-4 font-medium">Status</th>
                    <th className="text-left py-3 px-4 font-medium">Provider</th>
                    <th className="text-left py-3 px-4 font-medium">Date</th>
                    <th className="text-left py-3 px-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => {
                      const payment = order.payments[0];
                      return (
                        <tr key={order.id} className="border-b hover:bg-muted/30">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm">
                                {order.id.slice(0, 8)}...
                              </span>
                              {order.provider === "paypal" && (
                                <button
                                  onClick={() => copyToClipboard(order.id)}
                                  className="p-1 hover:bg-muted rounded"
                                  title="Copy Order ID"
                                >
                                  <Copy className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            {order.userEmail || "Unknown"}
                          </td>
                          <td className="py-3 px-4">
                            {formatCurrency(order.totalAmount, order.currency)}
                          </td>
                          <td className="py-3 px-4">
                            <Badge variant={getStatusBadgeVariant(order.status)}>
                              {order.status}
                            </Badge>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span className="capitalize">{order.provider}</span>
                              {payment && payment.providerPaymentId && (
                                order.provider === "stripe" ? (
                                  <a
                                    href={`https://dashboard.stripe.com/${process.env.NEXT_PUBLIC_VERCEL_ENV === "production" ? "" : "test/payments/"}${payment.providerPaymentId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800"
                                    title={`View in Stripe ${process.env.NEXT_PUBLIC_VERCEL_ENV === "production" ? "(production)" : "(test)"}`}
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </a>
                                ) : order.provider === "paypal" ? (
                                  <a
                                    href="https://www.paypal.com/myaccount/activity/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800"
                                    title="View in PayPal (search by Order ID)"
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </a>
                                ) : null
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-sm">
                            {formatDate(order.createdAt)}
                          </td>
                          <td className="py-3 px-4">
                            {order.status === "paid" && payment && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedOrder(order)}
                              >
                                Refund
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {((page - 1) * pageSize) + 1} to {Math.min(page * pageSize, total)} of {total} orders
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Refund Modal */}
      {selectedOrder && (
        <RefundModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onSuccess={handleRefundSuccess}
        />
      )}
    </div>
  );
}
