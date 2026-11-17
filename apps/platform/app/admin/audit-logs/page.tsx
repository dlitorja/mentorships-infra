"use client";

import React from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ExternalLink, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { getAdminAuditLogs } from "@/lib/queries/api-client";
import { ClerkUserIdCell } from "@/components/admin/clerk-user-id-cell";
import { getClerkDashboardUserUrl } from "@/lib/clerk-dashboard-url";

type AuditLog = {
  id: string;
  workspaceId: string;
  adminId: string;
  action: string;
  details: string | null;
  timestamp: number;
};

type AuditLogsResponse = {
  items: AuditLog[];
  continueCursor: string | null;
  isDone: boolean;
};

const PAGE_SIZE = 50;

export default function AuditLogsPage() {
  const {
    data,
    isLoading,
    isError,
    isFetchNextPageError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["admin-audit-logs"],
    queryFn: async ({ pageParam }) => {
      const result = await getAdminAuditLogs({ numItems: PAGE_SIZE, cursor: pageParam || undefined });
      return result as AuditLogsResponse;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.isDone ? undefined : lastPage.continueCursor,
  });

  const allLogs = data?.pages.flatMap((page) => page.items) || [];

  const getActionBadge = (action: string) => {
    switch (action) {
      case "view_workspace":
        return <Badge variant="outline">View</Badge>;
      case "send_message":
        return <Badge variant="default">Message</Badge>;
      case "create_workspace":
        return <Badge variant="secondary">Create</Badge>;
      case "create_admin_student_workspace":
        return <Badge variant="secondary">Create Student</Badge>;
      case "create_admin_instructor_workspace":
        return <Badge variant="secondary">Create Instructor</Badge>;
      default:
        return <Badge variant="outline">{action}</Badge>;
    }
  };

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Audit Logs</h1>
        <p className="text-muted-foreground">
          Track admin actions in workspaces
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Activity</CardTitle>
          <CardDescription>
            Showing {allLogs.length} loaded {allLogs.length === 1 ? "entry" : "entries"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : isError && allLogs.length === 0 ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-destructive">
                    Couldn&apos;t load audit logs
                  </p>
                  <p className="text-xs text-destructive/80 mt-1">
                    {error instanceof Error ? error.message : "The request failed."} Do not read this
                    as &quot;nothing happened&quot; — the log is unavailable, not empty.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* A failed Load More must not erase pages that already loaded. */}
              {isError && (
                <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm text-destructive">
                        {isFetchNextPageError
                          ? `Couldn't load the next page of audit logs${
                              error instanceof Error ? `: ${error.message}` : "."
                            } The entries below are already loaded and still valid.`
                          : `Couldn't refresh audit logs${
                              error instanceof Error ? `: ${error.message}` : "."
                            } The entries below were loaded earlier and may be out of date.`}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        isFetchNextPageError ? void fetchNextPage() : void refetch()
                      }
                    >
                      Retry
                    </Button>
                  </div>
                </div>
              )}
              <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium">Timestamp</th>
                    <th className="text-left py-3 px-4 font-medium">Admin</th>
                    <th className="text-left py-3 px-4 font-medium">Action</th>
                    <th className="text-left py-3 px-4 font-medium">Details</th>
                    <th className="text-left py-3 px-4 font-medium">Workspace</th>
                  </tr>
                </thead>
                <tbody>
                  {allLogs.map((log) => (
                    <tr key={log.id} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-4">
                        <div className="text-sm">
                          {new Date(log.timestamp).toLocaleString()}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <ClerkUserIdCell
                          id={log.adminId}
                          dashboardUrl={getClerkDashboardUserUrl(log.adminId)}
                        />
                      </td>
                      <td className="py-3 px-4">{getActionBadge(log.action)}</td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-muted-foreground">
                          {log.details || "-"}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/admin/workspaces/${log.workspaceId}`}>
                            <ExternalLink className="h-4 w-4 mr-1" />
                            View
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {allLogs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-muted-foreground">
                        No audit logs found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </>
          )}
          {hasNextPage && (
            <div className="flex justify-center py-4">
              <Button
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading more...
                  </>
                ) : (
                  "Load More"
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
