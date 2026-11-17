"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Users, ArrowUpDown, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAdminStats } from "@/lib/queries/api-client";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/**
 * Loading / error are owned here rather than by a `<Suspense>` boundary.
 *
 * `useSuspenseQuery` fetches during render, which also happens on the server —
 * where this client's relative `apiFetch("/api/admin/stats")` has no base URL
 * and threw `TypeError: Failed to parse URL` on every dashboard visit. A plain
 * `useQuery` fetches in an effect (browser only), and rendering the error
 * inline also stops one failing widget from replacing the whole dashboard.
 */
export function AdminStatsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="pt-6">
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function AdminStats() {
  const {
    data: stats,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["adminStats"],
    queryFn: getAdminStats,
    staleTime: 1000 * 60,
  });

  if (isPending) return <AdminStatsSkeleton />;

  if (isError) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">Stats unavailable</p>
              <p className="text-xs text-muted-foreground mt-1">
                {error instanceof Error ? error.message : "The request failed."}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card className={stats && !stats.hasStudentData ? "opacity-60" : ""}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Active Students</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {stats?.hasStudentData ? (
            <div className="text-2xl font-bold">{stats.totalActiveStudents}</div>
          ) : (
            <div className="text-2xl font-bold text-muted-foreground">No students yet</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Revenue (This Month)</CardTitle>
          <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {stats ? formatCurrency(stats.revenueThisMonth) : "-"}
          </div>
        </CardContent>
      </Card>

      <Card className={stats && !stats.hasHistoricalRevenue ? "opacity-60" : ""}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Revenue Change</CardTitle>
          <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {stats?.hasHistoricalRevenue ? (
            <>
              <div
                className={cn(
                  "text-2xl font-bold",
                  stats.revenueChange > 0
                    ? "text-green-600"
                    : stats.revenueChange < 0
                      ? "text-red-600"
                      : ""
                )}
              >
                {stats.revenueChange > 0
                  ? `+${stats.revenueChange.toFixed(1)}%`
                  : `${stats.revenueChange.toFixed(1)}%`}
              </div>
              <p className="text-xs text-muted-foreground">vs last month</p>
            </>
          ) : (
            <>
              <div className="text-2xl font-bold text-muted-foreground">No prior data</div>
              <p className="text-xs text-muted-foreground">Need more data to compare</p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Revenue (This Year)</CardTitle>
          <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {stats ? formatCurrency(stats.revenueThisYear) : "-"}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
