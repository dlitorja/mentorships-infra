"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ApiFetchError, createAdminRefund, getAdminOrders } from "@/lib/queries/api-client";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Copy,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";

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
  packs?: {
    id: string;
    instructorId: string;
    instructorName: string | null;
    instructorSlug: string | null;
    totalSessions: number;
    remainingSessions: number;
    status: string;
    expiresAt: number | null;
  }[];
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

/**
 * Stripe dashboard link for a payment intent. The old inline expression dropped
 * the `payments/` segment in production, producing `dashboard.stripe.com/<pi_…>`.
 */
function stripeDashboardUrl(paymentIntentId: string): string {
  const isTest = process.env.NEXT_PUBLIC_VERCEL_ENV !== "production";
  return `https://dashboard.stripe.com/${isTest ? "test/" : ""}payments/${paymentIntentId}`;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

/** Amount still refundable on a single payment. */
function refundableAmount(payment: { amount: string; refundedAmount: string | null }): number {
  const amount = parseFloat(payment.amount) || 0;
  const refunded = parseFloat(payment.refundedAmount || "0") || 0;
  // Money maths in cents avoids 0.1 + 0.2 drift in the cap check.
  return Math.max(0, Math.round((amount - refunded) * 100) / 100);
}

function RefundModal({
  order,
  onClose,
  onRefunded,
}: {
  order: Order;
  onClose: () => void;
  onRefunded: () => void;
}) {
  const refundablePayments = order.payments.filter((p) => refundableAmount(p) > 0);
  const [paymentId, setPaymentId] = useState(refundablePayments[0]?.id ?? "");
  const payment = order.payments.find((p) => p.id === paymentId) ?? refundablePayments[0];
  const [refundType, setRefundType] = useState<"full" | "partial">("full");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("Requested by customer");
  const [customReason, setCustomReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{
    amount: string;
    provider: string;
    providerRefundId: string | null;
  } | null>(null);

  const maxRefund = payment ? refundableAmount(payment) : 0;
  const totalPaid = order.payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  const totalRefunded = order.payments.reduce(
    (sum, p) => sum + (parseFloat(p.refundedAmount || "0") || 0),
    0
  );
  const partialValue = Number(amount);
  const partialValid =
    refundType === "full" ||
    (Number.isFinite(partialValue) && partialValue > 0 && partialValue <= maxRefund);
  const canSubmit = !!payment && maxRefund > 0 && partialValid && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payment || !canSubmit) return;
    setLoading(true);
    setError("");

    try {
      const result = await createAdminRefund({
        paymentId: payment.id,
        refundType,
        amount: refundType === "partial" ? amount : undefined,
        reason,
        customReason: reason === "Other" ? customReason : undefined,
      });

      setReceipt({
        amount: result.refund?.amount ?? (refundType === "full" ? maxRefund.toFixed(2) : amount),
        provider: result.refund?.provider ?? payment.provider,
        providerRefundId: result.refund?.providerRefundId ?? null,
      });
      onRefunded();
    } catch (err) {
      if (err instanceof ApiFetchError && typeof err.data === "object" && err.data !== null && "error" in err.data && typeof err.data.error === "string") {
        setError(err.data.error);
      } else {
        setError(err instanceof Error ? err.message : "Failed to process refund");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Process refund</DialogTitle>
          <DialogDescription>
            {order.userEmail ?? "Unknown customer"} · order {order.id.slice(0, 8)}…
          </DialogDescription>
        </DialogHeader>

        {receipt ? (
          <div className="space-y-4">
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
              <p className="font-medium">
                Refunded {formatCurrency(receipt.amount, order.currency)} via {receipt.provider}
              </p>
              <p className="mt-1 font-mono text-xs text-muted-foreground break-all">
                {receipt.providerRefundId
                  ? `refund id: ${receipt.providerRefundId}`
                  : "no provider refund id returned"}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Keep this id for reconciliation with {receipt.provider}. Sessions and workspace access
              were not changed.
            </p>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">Paid</dt>
                <dd className="text-right font-medium">
                  {formatCurrency(totalPaid.toFixed(2), order.currency)}
                </dd>
                <dt className="text-muted-foreground">Already refunded</dt>
                <dd className="text-right">
                  {formatCurrency(totalRefunded.toFixed(2), order.currency)}
                </dd>
                <dt className="text-muted-foreground">Refundable now</dt>
                <dd className="text-right font-medium">
                  {formatCurrency(
                    order.payments.reduce((sum, p) => sum + refundableAmount(p), 0).toFixed(2),
                    order.currency
                  )}
                </dd>
              </dl>
            </div>

            {order.packs && order.packs.length > 0 && (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p className="font-medium">What this order provided</p>
                <ul className="mt-1 space-y-1 text-muted-foreground">
                  {order.packs.map((pack) => (
                    <li key={pack.id}>
                      {pack.instructorName ?? "Instructor"} — {pack.totalSessions} sessions in pack,{" "}
                      {pack.remainingSessions} remaining
                      {pack.status !== "active" ? ` (pack ${pack.status})` : ""}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Refunding does not cancel these sessions or revoke workspace access — handle those
                  from the student and workspace screens.
                </p>
              </div>
            )}

            {order.payments.length > 1 && (
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="refund-payment">
                  Payment
                </label>
                <Select
                  value={paymentId}
                  onValueChange={(value) => {
                    setPaymentId(value);
                    setAmount("");
                    setRefundType("full");
                  }}
                >
                  <SelectTrigger id="refund-payment" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {order.payments.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.provider} · {formatCurrency(p.amount, p.currency)} ·{" "}
                        {refundableAmount(p) > 0
                          ? `${formatCurrency(refundableAmount(p).toFixed(2), p.currency)} refundable`
                          : "fully refunded"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <span className="text-sm font-medium">Refund type</span>
              <div className="mt-2 flex gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="refundType"
                    value="full"
                    checked={refundType === "full"}
                    onChange={() => setRefundType("full")}
                  />
                  Full ({formatCurrency(maxRefund.toFixed(2), order.currency)})
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="refundType"
                    value="partial"
                    checked={refundType === "partial"}
                    onChange={() => setRefundType("partial")}
                  />
                  Partial
                </label>
              </div>
            </div>

            {refundType === "partial" && (
              <div>
                <label className="text-sm font-medium" htmlFor="refund-amount">
                  Amount
                </label>
                <Input
                  id="refund-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={maxRefund}
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={`Up to ${maxRefund.toFixed(2)}`}
                  className="mt-1"
                />
                {!partialValid && (
                  <p className="mt-1 text-xs text-destructive">
                    Enter an amount between 0.01 and {formatCurrency(maxRefund.toFixed(2), order.currency)}.
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="text-sm font-medium" htmlFor="refund-reason">
                Reason
              </label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="refund-reason" className="w-full mt-1">
                  <SelectValue placeholder="Select reason" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Duplicate">Duplicate</SelectItem>
                  <SelectItem value="Fraudulent">Fraudulent</SelectItem>
                  <SelectItem value="Requested by customer">Requested by customer</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {reason === "Other" && (
              <div>
                <label className="text-sm font-medium" htmlFor="refund-custom-reason">
                  Custom reason
                </label>
                <Input
                  id="refund-custom-reason"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Enter reason..."
                  className="mt-1"
                />
              </div>
            )}

            {error && <div className="text-sm text-destructive">{error}</div>}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  `Refund ${formatCurrency(
                    (refundType === "full" ? maxRefund : partialValue || 0).toFixed(2),
                    order.currency
                  )}`
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
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
  const [error, setError] = useState<string | null>(null);

  // Filtering is server-side: the search must match the whole dataset, not the
  // rows that happen to be on the current page.
  const debouncedSearch = useDebouncedValue(search, 300);

  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize);

  // Reset the page during render when the effective filters change, so the
  // first request after a search is already page 1. An effect-based reset
  // fetched the old page first, and a slow response could land last and paint
  // the wrong rows (Greptile P1).
  const filtersKey = JSON.stringify([debouncedSearch, statusFilter]);
  const lastFiltersKeyRef = useRef(filtersKey);
  if (lastFiltersKeyRef.current !== filtersKey) {
    lastFiltersKeyRef.current = filtersKey;
    if (page !== 1) setPage(1);
  }

  // Guards against out-of-order responses overwriting newer results.
  const requestIdRef = useRef(0);

  const fetchOrders = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminOrders({
        status: statusFilter || undefined,
        search: debouncedSearch || undefined,
        page,
        pageSize,
      });
      if (requestId !== requestIdRef.current) return;

      setOrders(data.items);
      setTotal(data.total);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      // Failure is not "no orders" — say so, and offer a retry.
      setError(err instanceof Error ? err.message : "Failed to load orders");
      setOrders([]);
      setTotal(0);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [page, statusFilter, debouncedSearch]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
  };

  const handleRefunded = () => {
    // Keep the modal open so the admin sees the receipt; it refreshes the list
    // behind it and closes on Done.
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

            <Select value={statusFilter || "__all__"} onValueChange={(v) => { setStatusFilter(v === "__all__" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Status</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="refunded">Refunded</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>

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
          {error ? (
            <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-destructive">
                    Couldn&apos;t load orders
                  </p>
                  <p className="text-xs text-destructive/80 mt-1">{error}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => fetchOrders()}>
                  Retry
                </Button>
              </div>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-12">
              {search || statusFilter ? (
                <>
                  <p className="text-muted-foreground mb-2">
                    No orders match these filters
                  </p>
                  <p className="text-sm text-muted-foreground mb-4">
                    {search ? `Search: “${search}”` : null}
                    {search && statusFilter ? " · " : null}
                    {statusFilter ? `Status: ${statusFilter}` : null}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch("");
                      setStatusFilter("");
                      setPage(1);
                    }}
                  >
                    Clear filters
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-muted-foreground mb-2">No orders yet</p>
                  <p className="text-sm text-muted-foreground">
                    Orders will appear when customers make purchases
                  </p>
                </>
              )}
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
                  {orders.map((order) => {
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
                            <div>{order.userEmail || "Unknown"}</div>
                            {/* What was bought: instructor and sessions left. A
                                refund decision needs to know how much was
                                delivered. */}
                            {order.packs && order.packs.length > 0 && (
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {order.packs
                                  .map(
                                    (pack) =>
                                      `${pack.instructorName ?? "Instructor"}: ${pack.remainingSessions}/${pack.totalSessions} left${
                                        pack.status !== "active" ? ` (${pack.status})` : ""
                                      }`
                                  )
                                  .join(" · ")}
                              </div>
                            )}
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
                                    href={stripeDashboardUrl(payment.providerPaymentId)}
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
                            {order.status !== "canceled" &&
                              order.payments.some((p) => refundableAmount(p) > 0) && (
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
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              aria-label="Next page"
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
          onRefunded={handleRefunded}
        />
      )}
    </div>
  );
}
