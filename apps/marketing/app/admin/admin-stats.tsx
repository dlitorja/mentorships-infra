"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Users, ArrowUpDown, Package } from "lucide-react";
import { cn } from "@/lib/utils";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function AdminStats(): React.JSX.Element {
  const stats = useQuery(api.admin.getStats);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card className={stats && !stats.hasStudentData ? "opacity-60" : ""}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Active Students</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {stats ? (
            stats.hasStudentData ? (
              <div className="text-2xl font-bold">{stats.totalActiveStudents}</div>
            ) : (
              <div className="text-2xl font-bold text-muted-foreground">No students yet</div>
            )
          ) : (
            <div className="text-2xl font-bold text-muted-foreground">-</div>
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
                  stats.revenueChange > 0 ? "text-green-600" : stats.revenueChange < 0 ? "text-red-600" : ""
                )}
              >
                {stats.revenueChange > 0 ? "+" : ""}
                {stats.revenueChange.toFixed(1)}%
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                vs. {formatCurrency(stats.revenueLastMonth)} last month
              </p>
            </>
          ) : (
            <div className="text-2xl font-bold text-muted-foreground">-</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Inventory</CardTitle>
          <Package className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-muted-foreground">
            See /admin/instructors
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
