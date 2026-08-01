"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Users, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAdminStats } from "@/lib/queries/api-client";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function AdminStats() {
  const { data: stats } = useSuspenseQuery({
    queryKey: ["adminStats"],
    queryFn: getAdminStats,
    staleTime: 1000 * 60,
  });

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
