"use client";

import { useState, useEffect } from "react";
import { Id } from "../../../../convex/_generated/dataModel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, FileText, Image as ImageIcon, Link as LinkIcon, Loader2, Info, X, FolderArchive } from "lucide-react";
import WorkspaceChat from "@/components/workspace/chat";
import WorkspaceNotes from "@/components/workspace/notes";
import WorkspaceImages from "@/components/workspace/images";
import WorkspaceLinks from "@/components/workspace/links";
import WorkspaceResources from "@/components/workspace/resources";
import { RetentionWarningBanner } from "@/components/workspace/retention-warning-banner";
import type { UserRole } from "@/lib/auth-helpers";

type UserWorkspace = {
  _id: Id<"workspaces">;
  name?: string;
  description?: string;
  instructorId?: Id<"instructors">;
  sessionPackId?: Id<"sessionPacks">;
  endedAt?: number;
};

function WorkspaceContent({
  clerkUserId,
  workspaces,
  userRole,
}: {
  clerkUserId: string;
  workspaces: UserWorkspace[] | undefined;
  userRole: UserRole;
}) {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<Id<"workspaces"> | null>(null);
  const [activeTab, setActiveTab] = useState("chat");

  const workspacesLoading = false;

  useEffect(() => {
    if (workspaces && workspaces.length > 0 && !selectedWorkspaceId) {
      setSelectedWorkspaceId(workspaces[0]._id);
    }
  }, [workspaces, selectedWorkspaceId]);

  if (workspacesLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const selectedWorkspace = workspaces?.find((w: UserWorkspace) => w._id === selectedWorkspaceId);

  return (
    <div className="container mx-auto p-4 md:p-6">
      <div className="flex flex-col md:flex-row gap-6">
        <div className="w-full md:w-64 shrink-0">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Workspaces</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {workspaces && workspaces.length > 0 ? (
                <div className="space-y-1">
                  {workspaces.map((workspace: UserWorkspace) => (
                    <button
                      key={workspace._id}
                      onClick={() => setSelectedWorkspaceId(workspace._id)}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                        selectedWorkspaceId === workspace._id
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted"
                      }`}
                    >
                      <div className="font-medium truncate">{workspace.name}</div>
                      <div className="text-xs opacity-70 truncate">
                        Instructor workspace
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No workspaces yet</p>
                  <p className="text-xs mt-1">
                    Workspaces are created when you purchase a mentorship pack
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex-1 min-w-0">
          {selectedWorkspace ? (
            <Card className="flex flex-col">
              <CardHeader className="pb-3 shrink-0">
                <CardTitle className="text-xl">{selectedWorkspace.name}</CardTitle>
                {selectedWorkspace.description && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedWorkspace.description}
                  </p>
                )}
              </CardHeader>
              <CardContent className="flex-1 min-h-0 pt-0">
                <WorkspacePolicyBanner />
                {selectedWorkspace.endedAt && (
                  <RetentionWarningBanner
                    workspaceId={selectedWorkspace._id}
                    endedAt={selectedWorkspace.endedAt}
                  />
                )}
                <Tabs
                  value={activeTab}
                  onValueChange={setActiveTab}
                  className="flex flex-col"
                >
                  <TabsList className="shrink-0">
                    <TabsTrigger value="chat" className="gap-2">
                      <MessageSquare className="h-4 w-4" />
                      Chat
                    </TabsTrigger>
                    <TabsTrigger value="notes" className="gap-2">
                      <FileText className="h-4 w-4" />
                      Notes
                    </TabsTrigger>
                    <TabsTrigger value="images" className="gap-2">
                      <ImageIcon className="h-4 w-4" />
                      Images
                    </TabsTrigger>
                    <TabsTrigger value="links" className="gap-2">
                      <LinkIcon className="h-4 w-4" />
                      Links
                    </TabsTrigger>
                    {userRole !== 'student' && (
                      <TabsTrigger value="resources" className="gap-2">
                        <FolderArchive className="h-4 w-4" />
                        My Resources
                      </TabsTrigger>
                    )}
                  </TabsList>

                  <TabsContent value="chat" className="flex-1 min-h-0 mt-4">
                    <WorkspaceChat
                      workspaceId={selectedWorkspace._id}
                      currentUserId={clerkUserId}
                      role={userRole}
                    />
                  </TabsContent>
                  <TabsContent value="notes" className="flex-1 min-h-0 mt-4">
                    <WorkspaceNotes
                      workspaceId={selectedWorkspace._id}
                      currentUserId={clerkUserId}
                    />
                  </TabsContent>
                  <TabsContent value="images" className="flex-1 min-h-0 mt-4">
                    <WorkspaceImages
                      workspaceId={selectedWorkspace._id}
                      currentUserId={clerkUserId}
                      role={userRole}
                    />
                  </TabsContent>
                  <TabsContent value="links" className="flex-1 min-h-0 mt-4">
                    <WorkspaceLinks
                      workspaceId={selectedWorkspace._id}
                      currentUserId={clerkUserId}
                    />
                  </TabsContent>
                  {userRole !== 'student' && (
                    <TabsContent value="resources" className="flex-1 min-h-0 mt-4">
                      <WorkspaceResources
                        workspaceId={selectedWorkspace._id}
                        currentUserId={clerkUserId}
                        role={userRole}
                      />
                    </TabsContent>
                  )}
                </Tabs>
              </CardContent>
            </Card>
          ) : (
            <Card className="h-full flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Select a workspace to get started</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkspacePolicyBanner() {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <div className="mb-3 rounded-md border bg-muted/50 p-2 text-xs flex items-start gap-2">
      <Info className="h-4 w-4 mt-0.5 text-muted-foreground" />
      <div className="flex-1">
        Need to cancel or reschedule? Message your instructor here. Please try to inform them at least 24 hours in advance; instructors handle changes requested with less than 24 hours&apos; notice at their discretion.
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        className="opacity-70 hover:opacity-100"
        onClick={() => setVisible(false)}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

interface WorkspaceClientPageProps {
  clerkUserId: string;
  workspaces?: UserWorkspace[];
  userRole: UserRole;
}

export default function WorkspaceClientPage({ clerkUserId, workspaces, userRole }: WorkspaceClientPageProps) {
  return <WorkspaceContent clerkUserId={clerkUserId} workspaces={workspaces} userRole={userRole} />;
}
