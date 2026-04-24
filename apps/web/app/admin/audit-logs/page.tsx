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
import { Loader2, ExternalLink } from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/queries/api-client";

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

async function fetchAuditLogs(cursor?: string | null): Promise<AuditLogsResponse> {
  const params = new URLSearchParams();
  params.set("numItems", "100");
  if (cursor) params.set("cursor", cursor);
  
  return apiFetch<AuditLogsResponse>(`/api/admin/audit-logs?${params.toString()}`);
}

export default function AuditLogsPage() {
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["admin-audit-logs"],
    queryFn: ({ pageParam }) => fetchAuditLogs(pageParam),
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
      case "create_admin_mentee_workspace":
        return <Badge variant="secondary">Create Mentee</Badge>;
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
            {allLogs.length} log entries
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
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
                        <span className="font-mono text-sm">
                          {log.adminId.slice(0, 8)}...
                        </span>
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
