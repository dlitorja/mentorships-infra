"use client";

import React, { useState } from "react";
import Link from "next/link";
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
import { Loader2, ExternalLink, Plus } from "lucide-react";
import { apiFetch } from "@/lib/queries/api-client";

type Workspace = {
  id: string;
  name: string;
  description: string | null;
  type: "mentorship" | "admin_mentee" | "admin_instructor";
  ownerId: string;
  owner: { id: string; email: string; firstName: string | null } | null;
  mentorId: string | null;
  mentor: { id: string; userId: string } | null;
  isPublic: boolean;
  endedAt: number | null;
  createdAt: number;
  menteeImageCount: number;
  mentorImageCount: number;
};

type WorkspacesResponse = {
  items: Workspace[];
  continueCursor: string | null;
  isDone: boolean;
};

const PAGE_SIZE = 20;

async function fetchWorkspaces(type?: string, cursor?: string | null): Promise<WorkspacesResponse> {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  params.set("numItems", String(PAGE_SIZE));
  if (cursor) params.set("cursor", cursor);
  
  const url = `/api/admin/workspaces${params.toString() ? `?${params.toString()}` : ""}`;
  return apiFetch<WorkspacesResponse>(url);
}

export default function WorkspacesPage() {
  const [typeFilter, setTypeFilter] = useState<string>("");

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["admin-workspaces", typeFilter],
    queryFn: ({ pageParam }) => fetchWorkspaces(typeFilter || undefined, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.isDone ? undefined : lastPage.continueCursor,
  });

  const allWorkspaces = data?.pages.flatMap((page) => page.items) || [];

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "admin_mentee":
        return <Badge variant="default">Admin-Mentee</Badge>;
      case "admin_instructor":
        return <Badge variant="secondary">Admin-Instructor</Badge>;
      default:
        return <Badge variant="outline">Mentorship</Badge>;
    }
  };

  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Workspaces</h1>
          <p className="text-muted-foreground">
            Manage and view all workspaces across the platform
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/workspaces/create?type=admin_mentee">
              <Plus className="mr-2 h-4 w-4" />
              New Admin-Mentee Workspace
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin/workspaces/create?type=admin_instructor">
              <Plus className="mr-2 h-4 w-4" />
              New Admin-Instructor Workspace
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>All Workspaces</CardTitle>
              <CardDescription>
                {allWorkspaces.length} workspaces found
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <select
                className="border rounded-md px-3 py-2 text-sm"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="">All Types</option>
                <option value="mentorship">Mentorship</option>
                <option value="admin_mentee">Admin-Mentee</option>
                <option value="admin_instructor">Admin-Instructor</option>
              </select>
            </div>
          </div>
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
                    <th className="text-left py-3 px-4 font-medium">Name</th>
                    <th className="text-left py-3 px-4 font-medium">Type</th>
                    <th className="text-left py-3 px-4 font-medium">Owner</th>
                    <th className="text-left py-3 px-4 font-medium">Mentor</th>
                    <th className="text-left py-3 px-4 font-medium">Images</th>
                    <th className="text-left py-3 px-4 font-medium">Created</th>
                    <th className="text-left py-3 px-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allWorkspaces.map((workspace) => (
                    <tr key={workspace.id} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-4">
                        <div className="font-medium">{workspace.name}</div>
                        {workspace.description && (
                          <div className="text-sm text-muted-foreground truncate max-w-xs">
                            {workspace.description}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">{getTypeBadge(workspace.type)}</td>
                      <td className="py-3 px-4">
                        {workspace.owner ? (
                          <div>
                            <div className="text-sm">
                              {workspace.owner.firstName || "Unknown"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {workspace.owner.email}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {workspace.mentor ? (
                          <span className="text-sm font-mono">
                            {workspace.mentor.userId.slice(0, 8)}...
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-sm">
                          <span className="text-muted-foreground">M:</span> {workspace.menteeImageCount}
                          <span className="text-muted-foreground ml-2">I:</span> {workspace.mentorImageCount}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {workspace.createdAt ? (
                          <span className="text-sm">
                            {new Date(workspace.createdAt).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/admin/workspaces/${workspace.id}`}>
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {allWorkspaces.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-muted-foreground">
                        No workspaces found
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
