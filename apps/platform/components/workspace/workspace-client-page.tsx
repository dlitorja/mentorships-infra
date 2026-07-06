"use client";

import { useState, useEffect } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
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
import { SessionCountControls } from "@/components/workspace/session-count-controls";
import { VideoCallProvider } from "@/components/video/video-call-provider";
import { VideoPanel } from "@/components/video/video-panel";
import { CallStatusPill } from "@/components/video/call-status-pill";
import type { UserRole } from "@/lib/auth-helpers";

type UserWorkspace = {
  _id: Id<"workspaces">;
  name?: string;
  description?: string;
  ownerId?: string;
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
  const isChatTab = activeTab === "chat";

  return (
    <VideoCallProvider workspaceId={selectedWorkspaceId}>
      <div className={`container mx-auto p-4 md:p-6 ${isChatTab ? "h-[calc(100dvh-64px)]" : ""}`}>
        <div className={`flex flex-col md:flex-row gap-6 ${isChatTab ? "h-full" : ""}`}>
          <div className="w-full md:w-64 shrink-0">
            <Card className={isChatTab ? "h-full" : ""}>
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
                      Workspaces are created when you purchase a session pack
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex-1 min-w-0">
            {selectedWorkspace ? (
              <Card className={`flex flex-col ${isChatTab ? "h-full" : ""}`}>
                <CardHeader className="pb-3 shrink-0">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <CardTitle className="text-xl">{selectedWorkspace.name}</CardTitle>
                      {selectedWorkspace.description && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {selectedWorkspace.description}
                        </p>
                      )}
                    </div>
                    {userRole === "instructor" && selectedWorkspace.sessionPackId && (
                      <SessionCountControls sessionPackId={selectedWorkspace.sessionPackId} />
                    )}
                  </div>
                </CardHeader>

                {/* PR #3: action row between header and tabs for the call pill
                 * and a one-line note that the workspace chat persists across
                 * calls (Daily's in-call chat is disabled). */}
                <div className="px-6 pb-3 flex flex-wrap items-center gap-3 shrink-0">
                  <CallStatusPill />
                  <p className="text-xs text-muted-foreground">
                    Chat here stays open during calls — Daily&apos;s in-call chat is disabled.
                  </p>
                </div>

                <CardContent className={isChatTab ? "flex-1 min-h-0 pt-0" : "pt-0"}>
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
                    className={`flex flex-col ${isChatTab ? "h-full" : ""}`}
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

                    {isChatTab ? (
                      <ChatTabWithVideo
                        workspaceId={selectedWorkspace._id}
                        clerkUserId={clerkUserId}
                        role={userRole}
                      />
                    ) : (
                      <>
                        <TabsContent value="notes" className="mt-4">
                          <WorkspaceNotes
                            workspaceId={selectedWorkspace._id}
                            currentUserId={clerkUserId}
                          />
                        </TabsContent>
                        <TabsContent value="images" className="mt-4">
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
                      </>
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
    </VideoCallProvider>
  );
}

/**
 * Chat tab content with optional resizable split for an active video
 * call. When no call is active, renders the chat alone. When a call
 * is active, splits horizontally — chat on the left, video on the
 * right. Default 60/40 split with a 360px minimum panel width.
 *
 * The split uses `react-resizable-panels` which is uncontrolled
 * internally; we persist the user's preferred ratio via a stable
 * panel id and the library's `defaultLayout` prop is read once on
 * mount. PR #3's `useSplitRatio` hook is the explicit persistence
 * layer for that value.
 */
function ChatTabWithVideo({
  workspaceId,
  clerkUserId,
  role,
}: {
  workspaceId: Id<"workspaces">;
  clerkUserId: string;
  role: UserRole;
}) {
  return (
    <div className="flex-1 min-h-0 mt-4">
      <Group orientation="horizontal" id={`workspace-${workspaceId}-chat-video`}>
        <Panel id="chat" defaultSize={60} minSize={20}>
          <WorkspaceChat
            workspaceId={workspaceId}
            currentUserId={clerkUserId}
            role={role}
          />
        </Panel>
        <Separator className="w-1.5 bg-border transition-colors hover:bg-primary" />
        <Panel id="video" defaultSize={40} minSize={20}>
          <VideoPanel className="h-full" />
        </Panel>
      </Group>
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
