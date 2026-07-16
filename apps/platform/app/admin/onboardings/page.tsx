"use client";

import React, { useState } from "react";
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
import { Loader2, AlertTriangle, ListChecks, Eye } from "lucide-react";
import { useListAdminOnboardings } from "@/lib/queries/convex/use-admin-onboardings";
import { statusLabel, type OnboardingStatus } from "@/lib/admin-onboarding";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { RetryOnboardingButton } from "@/components/admin/retry-onboarding-button";

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

export default function AdminOnboardingsPage(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<typeof TABS[number]["value"]>("needs-attention");
  const [emailInput, setEmailInput] = useState("");
  const [bulkFilter, setBulkFilter] = useState<BulkFilter>("all");
  const debouncedEmail = useDebouncedValue(emailInput, 300);

  const tab = TABS.find((t) => t.value === activeTab) ?? TABS[0];

  const { data, isLoading, error } = useListAdminOnboardings({
    status: tab.status ?? undefined,
    emailSearch: debouncedEmail || undefined,
    limit: 50,
  });

  const allItems = data ?? [];
  const items = allItems.filter((item) => matchesBulkFilter(item, bulkFilter));

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
        <div className="w-64">
          <Input
            placeholder="Filter by email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
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
                          <th className="text-left py-3 px-4 font-medium">Submitted</th>
                          <th className="text-left py-3 px-4 font-medium">Email</th>
                          <th className="text-left py-3 px-4 font-medium">Source</th>
                          <th className="text-left py-3 px-4 font-medium">Instructors</th>
                          <th className="text-left py-3 px-4 font-medium">Status</th>
                          <th className="text-left py-3 px-4 font-medium">Attempts</th>
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
