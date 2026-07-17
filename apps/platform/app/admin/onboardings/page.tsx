"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Loader2,
  AlertTriangle,
  ListChecks,
  Eye,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Download,
} from "lucide-react";
import { useListAdminOnboardings } from "@/lib/queries/convex/use-admin-onboardings";
import { statusLabel, type OnboardingStatus } from "@/lib/admin-onboarding";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { RetryOnboardingButton } from "@/components/admin/retry-onboarding-button";
import {
  DEFAULT_SORT_COLUMN,
  DEFAULT_SORT_DIRECTION,
  rowsToCsv,
  sortItems,
  type SortColumn,
  type SortDirection,
} from "../../../lib/admin-onboarding/list";

const STATUS_VARIANTS: Record<
  OnboardingStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  queued: "outline",
  processing: "default",
  completed: "secondary",
  failed: "destructive",
  cancelled: "outline",
};

const TABS: Array<{
  value: "needs-attention" | "pending-signup" | "in-progress" | "completed" | "cancelled";
  label: string;
  status: OnboardingStatus | null;
}> = [
  { value: "needs-attention", label: "Needs attention", status: "failed" },
  { value: "pending-signup", label: "Pending signup", status: "queued" },
  { value: "in-progress", label: "In progress", status: "processing" },
  { value: "completed", label: "Completed", status: "completed" },
  { value: "cancelled", label: "Cancelled", status: "cancelled" },
];

const DAY_MS = 86_400_000;
const FAILED_LAST_7D_CUTOFF_MS = 7 * DAY_MS;
const STALE_CUTOFF_MS = 13 * DAY_MS;

type BulkFilter = "all" | "failed-last-7d" | "stale-13d";
const BULK_FILTERS: Array<{ value: BulkFilter; label: string; description: string }> = [
  { value: "all", label: "All", description: "Show every row in the current tab" },
  { value: "failed-last-7d", label: "Failed (last 7d)", description: "Only rows updated in the last 7 days" },
  { value: "stale-13d", label: "Stale (13d+)", description: "Rows still pending or in-progress after 13 days" },
];

function matchesBulkFilter(
  item: { createdAt: number; lastAttemptAt?: number; status: OnboardingStatus },
  filter: BulkFilter
): boolean {
  const now = Date.now();
  if (filter === "all") return true;
  if (filter === "failed-last-7d") {
    if (item.status !== "failed") return false;
    const updatedAt = item.lastAttemptAt ?? item.createdAt;
    return now - updatedAt <= FAILED_LAST_7D_CUTOFF_MS;
  }
  if (filter === "stale-13d") {
    if (item.status !== "queued" && item.status !== "processing") return false;
    const ageMs = now - item.createdAt;
    return ageMs >= STALE_CUTOFF_MS;
  }
  return true;
}

function formatRelative(ms: number | null | undefined): string {
  if (!ms) return "-";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// PR 11: client-side CSV download trigger. Hand-rolled to avoid pulling
// in papaparse for a one-off export. Prepends a UTF-8 BOM so Excel
// renders non-ASCII characters correctly without manual import.
function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function AdminOnboardingsPage(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<typeof TABS[number]["value"]>("needs-attention");
  const [searchInput, setSearchInput] = useState("");
  const [bulkFilter, setBulkFilter] = useState<BulkFilter>("all");
  const [sortColumn, setSortColumn] = useState<SortColumn>(DEFAULT_SORT_COLUMN);
  const [sortDirection, setSortDirection] = useState<SortDirection>(DEFAULT_SORT_DIRECTION);
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  const tab = TABS.find((t) => t.value === activeTab) ?? TABS[0];

  // PR 11: a single search input fans out to both emailSearch and
  // instructorSearch server-side. The Convex query unions the two
  // filters (email OR any per-instructor name contains the substring).
  const trimmedSearch = debouncedSearch.trim();

  const { data, isLoading, error } = useListAdminOnboardings({
    status: tab.status ?? undefined,
    emailSearch: trimmedSearch || undefined,
    instructorSearch: trimmedSearch || undefined,
    limit: 50,
  });

  const allItems = data ?? [];
  const filteredItems = allItems.filter((item) => matchesBulkFilter(item, bulkFilter));
  const items = useMemo(
    () => sortItems(filteredItems, sortColumn, sortDirection),
    [filteredItems, sortColumn, sortDirection]
  );

  function toggleSort(column: SortColumn): void {
    if (sortColumn === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  }

  function handleDownloadCsv(): void {
    if (items.length === 0) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadCsv(`admin-onboardings-${tab.value}-${stamp}.csv`, rowsToCsv(items));
  }

  function sortIcon(column: SortColumn): React.JSX.Element {
    if (sortColumn !== column) return <ArrowUpDown className="inline h-3 w-3 ml-1 text-muted-foreground" />;
    return sortDirection === "asc" ? (
      <ArrowUp className="inline h-3 w-3 ml-1" />
    ) : (
      <ArrowDown className="inline h-3 w-3 ml-1" />
    );
  }

  const sortableHeader = (
    column: SortColumn,
    label: string
  ): React.JSX.Element => (
    <th
      className="text-left py-3 px-4 font-medium"
      aria-sort={
        sortColumn === column
          ? sortDirection === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button
        type="button"
        className="inline-flex items-center cursor-pointer select-none hover:bg-muted/50 -mx-4 px-4 py-3 w-full text-left font-medium"
        onClick={() => toggleSort(column)}
      >
        {label}
        {sortIcon(column)}
      </button>
    </th>
  );

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ListChecks className="h-7 w-7" />
            Admin Onboardings
          </h1>
          <p className="text-muted-foreground">
            Recovery view for Kajabi and other admin-onboarded session pack submissions.
          </p>
        </div>
        <div className="w-72">
          <Input
            placeholder="Search email or instructor name"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search by email or instructor name"
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as typeof activeTab); setBulkFilter("all"); }}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((t) => (
          <TabsContent key={t.value} value={t.value}>
            <Card>
              <CardHeader>
                <CardTitle>{t.label}</CardTitle>
                <CardDescription>
                  {isLoading
                    ? "Loading…"
                    : `${items.length} submission${items.length === 1 ? "" : "s"}${bulkFilter === "all" ? "" : ` (filtered: ${BULK_FILTERS.find((f) => f.value === bulkFilter)?.label ?? bulkFilter})`}`}
                </CardDescription>
              </CardHeader>
              <div className="px-6 pb-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground mr-1">Bulk filter:</span>
                {BULK_FILTERS.map((f) => (
                  <Button
                    key={f.value}
                    type="button"
                    size="sm"
                    variant={bulkFilter === f.value ? "default" : "outline"}
                    onClick={() => setBulkFilter(f.value)}
                    title={f.description}
                  >
                    {f.label}
                  </Button>
                ))}
                {bulkFilter !== "all" && allItems.length !== items.length ? (
                  <span className="text-xs text-muted-foreground ml-2">
                    ({allItems.length - items.length} hidden by filter)
                  </span>
                ) : null}
                <div className="ml-auto">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleDownloadCsv}
                    disabled={items.length === 0}
                    title={
                      items.length === 0
                        ? "No rows to export"
                        : `Download ${items.length} row${items.length === 1 ? "" : "s"} as CSV`
                    }
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Download CSV
                  </Button>
                </div>
              </div>
              <CardContent>
                {error ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                    <AlertTriangle className="inline h-4 w-4 mr-2" />
                    Failed to load: {String((error as Error).message ?? error)}
                  </div>
                ) : isLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                ) : items.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    {bulkFilter !== "all" && allItems.length > 0
                      ? "All submissions are hidden by the active filter."
                      : "No onboardings in this state."}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          {sortableHeader("createdAt", "Submitted")}
                          <th className="text-left py-3 px-4 font-medium">Email</th>
                          <th className="text-left py-3 px-4 font-medium">Source</th>
                          <th className="text-left py-3 px-4 font-medium">Instructors</th>
                          {sortableHeader("status", "Status")}
                          {sortableHeader("attemptCount", "Attempts")}
                          <th className="text-left py-3 px-4 font-medium">Failure</th>
                          <th className="text-left py-3 px-4 font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => (
                          <tr key={item._id} className="border-b hover:bg-muted/50">
                            <td className="py-3 px-4 text-sm">
                              {formatRelative(item.createdAt)}
                            </td>
                            <td className="py-3 px-4 font-mono text-sm">{item.email}</td>
                            <td className="py-3 px-4">
                              <Badge variant="outline">{item.source}</Badge>
                            </td>
                            <td className="py-3 px-4 text-sm">
                              {item.perInstructor.length} ({item.perInstructor.filter((p) => p.isRenewal).length} renewal)
                            </td>
                            <td className="py-3 px-4">
                              <Badge variant={STATUS_VARIANTS[item.status]}>
                                {statusLabel(item.status)}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-sm">{item.attemptCount}</td>
                            <td className="py-3 px-4 text-sm text-muted-foreground">
                              {item.failureReason ?? "-"}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <RetryOnboardingButton
                                  onboardingId={item._id}
                                  currentStatus={item.status}
                                  variant="ghost"
                                  size="sm"
                                  label="Retry"
                                />
                                <Button variant="ghost" size="sm" asChild>
                                  <Link href={`/admin/onboardings/${item._id}`}>
                                    <Eye className="h-4 w-4 mr-1" />
                                    View
                                  </Link>
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
