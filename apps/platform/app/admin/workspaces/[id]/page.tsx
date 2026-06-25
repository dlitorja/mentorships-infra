"use client";

import React, { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ArrowLeft, User, Users, MessageSquare, ScrollText } from "lucide-react";
import { apiFetch } from "@/lib/queries/api-client";
import { WorkspaceDeleteDialog } from "@/components/admin/workspace-delete-dialog";
import { Settings2 } from "lucide-react";
import { UserCircle } from "lucide-react";

type WorkspaceOwner = {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
} | null;

type WorkspaceInstructor = {
  userId: string;
  bio: string | null;
  pricing: string | null;
} | null;

type Message = {
  id: string;
  userId: string;
  content: string;
  type: string;
  senderRole: string;
  createdAt: number;
};

type AuditLog = {
  id: string;
  adminId: string;
  action: string;
  details: string | null;
  timestamp: number;
};

type WorkspaceDetail = {
  id: string;
  name: string;
  description: string | null;
  type: "mentorship" | "admin_student" | "admin_instructor";
  ownerId: string;
  owner: WorkspaceOwner;
  instructorId: string | null;
  instructor: WorkspaceInstructor;
  isPublic: boolean;
  endedAt: number | null;
  createdAt: number;
  studentImageCount: number;
  instructorImageCount: number;
  messages: Message[];
  auditLogs: {
    items: AuditLog[];
    continueCursor: string | null;
    isDone: boolean;
  };
};

async function fetchWorkspace(id: string): Promise<WorkspaceDetail> {
  return apiFetch<WorkspaceDetail>(`/api/admin/workspaces/${id}`);
}

export default function WorkspaceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const workspaceId = resolvedParams.id;

  const { data: workspace, isLoading, error } = useQuery({
    queryKey: ["admin-workspace", workspaceId],
    queryFn: () => fetchWorkspace(workspaceId),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center text-destructive">
          Failed to load workspace: {error?.message || "Not found"}
        </div>
      </div>
    );
  }

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "admin_student":
        return <Badge variant="default">Admin-Student</Badge>;
      case "admin_instructor":
        return <Badge variant="secondary">Admin-Instructor</Badge>;
      default:
        return <Badge variant="outline">Mentorship</Badge>;
    }
  };

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleString();
  };

  const formatAction = (action: string) => {
    return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <div className="container mx-auto py-8">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/workspaces" aria-label="Back to workspaces">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{workspace.name}</h1>
            {getTypeBadge(workspace.type)}
          </div>
          {workspace.description && (
            <p className="text-muted-foreground">{workspace.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href={`/admin/workspaces/${workspaceId}/settings`}>
              <Settings2 className="mr-2 h-4 w-4" />
              Settings
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/admin/workspaces/${workspaceId}/members`}>
              <UserCircle className="mr-2 h-4 w-4" />
              Members
            </Link>
          </Button>
          <WorkspaceDeleteDialog
            workspaceId={workspaceId}
            workspaceName={workspace.name}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <User className="h-4 w-4" />
              Owner
            </CardTitle>
          </CardHeader>
          <CardContent>
            {workspace.owner ? (
              <div>
                <div className="font-medium">
                  {workspace.owner.firstName || "Unknown"}
                </div>
                <div className="text-sm text-muted-foreground">
                  {workspace.owner.email}
                </div>
              </div>
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Instructor
            </CardTitle>
          </CardHeader>
          <CardContent>
            {workspace.instructor ? (
              <div>
                <div className="font-medium font-mono text-sm">
                  {workspace.instructor.userId.slice(0, 12)}...
                </div>
                {workspace.instructor.bio && (
                  <div className="text-sm text-muted-foreground truncate">
                    {workspace.instructor.bio.slice(0, 50)}...
                  </div>
                )}
              </div>
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Images</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm">
              <span className="text-muted-foreground">Student:</span> {workspace.studentImageCount}
              <span className="text-muted-foreground ml-3">Instructor:</span> {workspace.instructorImageCount}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="messages">
        <TabsList>
          <TabsTrigger value="messages">
            <MessageSquare className="mr-2 h-4 w-4" />
            Messages ({workspace.messages?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="audit">
            <ScrollText className="mr-2 h-4 w-4" />
            Audit Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="messages">
          <Card>
            <CardHeader>
              <CardTitle>Messages</CardTitle>
              <CardDescription>
                Communication history in this workspace
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!workspace.messages || workspace.messages.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No messages yet
                </div>
              ) : (
                <div className="space-y-4">
                  {workspace.messages.map((message) => (
                    <div
                      key={message.id}
                      className="border rounded-lg p-4"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-medium text-sm">
                          {message.senderRole || "Unknown"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatTimestamp(message.createdAt)}
                        </div>
                      </div>
                      <div className="text-sm">{message.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle>Audit Logs</CardTitle>
              <CardDescription>
                Admin actions performed on this workspace
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!workspace.auditLogs?.items || workspace.auditLogs.items.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No audit logs yet
                </div>
              ) : (
                <div className="space-y-2">
                  {workspace.auditLogs.items.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-start gap-4 p-3 border rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="font-medium text-sm">
                          {formatAction(log.action)}
                        </div>
                        {log.details && (
                          <div className="text-sm text-muted-foreground">
                            {log.details}
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground mt-1">
                          Admin: {log.adminId.slice(0, 8)}... | {formatTimestamp(log.timestamp)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}