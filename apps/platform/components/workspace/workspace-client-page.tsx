"use client";

import { useCallback, useState, useEffect } from "react";
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
import { StartAdhocButton } from "@/components/video/start-adhoc-button";
import { WaitingRoom } from "@/components/video/waiting-room";
import QuickCapture from "@/components/video/quick-capture";
import { WorkspaceRowBadge } from "@/components/workspace/workspace-row-badge";
import { useSplitRatio } from "@/lib/hooks/use-split-ratio";
import { useVideoCallContext } from "@/lib/video/video-context";
import { DEFAULT_SPLIT_RATIO, SPLIT_RATIO_STORAGE_KEY } from "@/lib/video/constants";
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
  initialWorkspaceId,
  initialJoinSessionId,
}: {
  clerkUserId: string;
  workspaces: UserWorkspace[] | undefined;
  userRole: UserRole;
  initialWorkspaceId?: Id<"workspaces">;
  initialJoinSessionId?: Id<"sessions">;
}) {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<Id<"workspaces"> | null>(
    initialWorkspaceId ?? null
  );
  const [activeTab, setActiveTab] = useState("chat");
  // sessionId from the active call, passed down to Notes/Images/Links/Chat
  // composers for auto-tagging during the call. Read from
  // VideoCallContext inside `<WorkspaceInner>` so it tracks the active
  // session reactively (recomputed as `markCallStarted` fires).
  // null when no call is active.

  const workspacesLoading = false;

  useEffect(() => {
    if (
      workspaces &&
      workspaces.length > 0 &&
      !selectedWorkspaceId &&
      initialWorkspaceId === undefined
    ) {
      setSelectedWorkspaceId(workspaces[0]._id);
    }
  }, [workspaces, selectedWorkspaceId, initialWorkspaceId]);

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
    <VideoCallProvider
      // key on workspaceId so the entire video call state (Daily
      // call, joined room, local PiP position, device state) is reset
      // when the user switches workspaces. Without the key, the same
      // provider instance would carry over the previous workspace's
      // call object — `useVideoCall` couldn't re-bind to the new
      // session, and unmount cleanup of the old call would never fire.
      key={selectedWorkspaceId}
      workspaceId={selectedWorkspaceId}
      initialJoinSessionId={initialJoinSessionId}
    >
      <WorkspaceInner
        clerkUserId={clerkUserId}
        workspaces={workspaces}
        userRole={userRole}
        selectedWorkspaceId={selectedWorkspaceId}
        onSelectWorkspace={setSelectedWorkspaceId}
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        selectedWorkspace={selectedWorkspace}
        isChatTab={isChatTab}
      />
      {/*
       * PR #4b: QuickCapture mounts once inside the provider so
       * `useVideoCallContext().session` is available. The component
       * itself returns null when no call is active, so it has no
       * effect outside an active call.
       */}
      <QuickCapture />
    </VideoCallProvider>
  );
}

/**
 * Renders the workspace chrome (sidebar + tab content) using the
 * `useVideoCallContext()` hook so the live sessionId is reactive.
 * Pulled out of `WorkspaceContent` so the hook can be called inside
 * the `<VideoCallProvider>` boundary.
 */
function WorkspaceInner({
  clerkUserId,
  workspaces,
  userRole,
  selectedWorkspaceId,
  onSelectWorkspace,
  activeTab,
  onChangeTab,
  selectedWorkspace,
  isChatTab,
}: {
  clerkUserId: string;
  workspaces: UserWorkspace[] | undefined;
  userRole: UserRole;
  selectedWorkspaceId: Id<"workspaces"> | null;
  onSelectWorkspace: (id: Id<"workspaces">) => void;
  activeTab: string;
  onChangeTab: (tab: string) => void;
  selectedWorkspace: UserWorkspace | undefined;
  isChatTab: boolean;
}) {
  const { session } = useVideoCallContext();
  // PR #4b: pass `sessionId` down to composers so posts during the
  // active call are auto-tagged. `null` outside an active call.
  const activeSessionId: Id<"sessions"> | null =
    session?.sessionId ?? null;

  return (
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
                      onClick={() => onSelectWorkspace(workspace._id)}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                        selectedWorkspaceId === workspace._id
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted"
                      }`}
                    >
                      <div className="flex items-center">
                        <div className="font-medium truncate flex-1">{workspace.name}</div>
                        {/* PR #4c-2: red dot on the workspace picker
                         * row when an ad-hoc call invite is active
                         * for the current user in this workspace. */}
                        <WorkspaceRowBadge workspaceId={workspace._id} />
                      </div>
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
               * calls (Daily's in-call chat is disabled).
               * PR #4a adds the instructor-only "Start ad-hoc call" button
               * and the waiting-room admit control (also instructor-only;
               * `<WaitingRoom>` self-hides when there are no waiters). */}
              <div className="px-6 pb-3 flex flex-wrap items-center gap-3 shrink-0">
                <CallStatusPill />
                {selectedWorkspace && userRole === "instructor" && (
                  <StartAdhocButton
                    workspaceId={selectedWorkspace._id}
                    role={userRole}
                  />
                )}
                <WaitingRoom role={userRole} />
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
                  onValueChange={onChangeTab}
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
                    <TabsContent
                      value="chat"
                      className="flex-1 min-h-0 mt-4 flex flex-col"
                    >
                      <ChatTabWithVideo
                        workspaceId={selectedWorkspace._id}
                        clerkUserId={clerkUserId}
                        role={userRole}
                        activeSessionId={activeSessionId}
                      />
                    </TabsContent>
                  ) : (
                    <>
                      <TabsContent value="notes" className="mt-4">
                        <WorkspaceNotes
                          workspaceId={selectedWorkspace._id}
                          currentUserId={clerkUserId}
                          activeSessionId={activeSessionId}
                        />
                      </TabsContent>
                      <TabsContent value="images" className="mt-4">
                        <WorkspaceImages
                          workspaceId={selectedWorkspace._id}
                          currentUserId={clerkUserId}
                          role={userRole}
                          activeSessionId={activeSessionId}
                        />
                      </TabsContent>
                      <TabsContent value="links" className="flex-1 min-h-0 mt-4">
                        <WorkspaceLinks
                          workspaceId={selectedWorkspace._id}
                          currentUserId={clerkUserId}
                          activeSessionId={activeSessionId}
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
  );
}

/**
 * Chat tab content with optional resizable split for an active video
 * call. When no call is active, renders the chat full-width (no
 * split, no separator). When a call is active, splits horizontally
 * — chat on the left, video on the right. Default 60/40 split.
 *
 * Reading from `VideoCallContext` here instead of taking the session
 * as a prop keeps the "should we split?" decision inside the same
 * tree that knows whether the user has joined a call, without
 * plumbing through extra props.
 */
function ChatTabWithVideo({
  workspaceId,
  clerkUserId,
  role,
  activeSessionId,
}: {
  workspaceId: Id<"workspaces">;
  clerkUserId: string;
  role: UserRole;
  activeSessionId: Id<"sessions"> | null;
}): React.ReactElement {
  const { status } = useVideoCallContext();
  const { ratio, setRatio } = useSplitRatio(
    SPLIT_RATIO_STORAGE_KEY,
    DEFAULT_SPLIT_RATIO
  );
  const chatSize = ratio;
  const videoSize = 100 - ratio;

  // Render the split only when an active call is in progress. When no
  // call is active, give the chat full width so users aren't looking
  // at a blank 40% right column.
  const isInCall =
    status === "joined" || status === "joining" || status === "leaving";

  const onLayoutChanged = useCallback(
    (layout: { [id: string]: number }) => {
      // react-resizable-panels calls `onLayoutChanged` once per
      // completed resize (e.g. on pointerup) — much better than
      // `onLayoutChange` which fires on every pointermove. Layout is
      // keyed by panel id (we have id="chat" and id="video").
      const chatPanelSize = layout["chat"];
      if (typeof chatPanelSize === "number") {
        setRatio(chatPanelSize);
      }
    },
    [setRatio]
  );

  if (!isInCall) {
    return (
      <WorkspaceChat
        workspaceId={workspaceId}
        currentUserId={clerkUserId}
        role={role}
        activeSessionId={activeSessionId}
      />
    );
  }

  return (
    <Group
      orientation="horizontal"
      id={`workspace-${workspaceId}-chat-video`}
      onLayoutChanged={onLayoutChanged}
    >
      <Panel id="chat" defaultSize={chatSize} minSize={20}>
        <WorkspaceChat
          workspaceId={workspaceId}
          currentUserId={clerkUserId}
          role={role}
          activeSessionId={activeSessionId}
        />
      </Panel>
      <Separator className="w-1.5 bg-border transition-colors hover:bg-primary" />
      <Panel id="video" defaultSize={videoSize} minSize={20}>
        <VideoPanel className="h-full" />
      </Panel>
    </Group>
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
  /**
   * PR #4c-2: pre-select this workspace instead of defaulting to
   * the first one in the list. Set by the `/workspace/[id]` route
   * so the deep-link from a notification lands the user in the
   * right workspace without a picker step.
   */
  initialWorkspaceId?: Id<"workspaces">;
  /**
   * PR #4c-2: auto-join the given session id once the page mounts.
   * Set by the `/workspace/[id]?join={sessionId}` route so the
   * deep-link from a notification skips the consent modal and
   * lands the user directly in the join flow.
   */
  initialJoinSessionId?: Id<"sessions">;
}

export default function WorkspaceClientPage({
  clerkUserId,
  workspaces,
  userRole,
  initialWorkspaceId,
  initialJoinSessionId,
}: WorkspaceClientPageProps) {
  return (
    <WorkspaceContent
      clerkUserId={clerkUserId}
      workspaces={workspaces}
      userRole={userRole}
      initialWorkspaceId={initialWorkspaceId}
      initialJoinSessionId={initialJoinSessionId}
    />
  );
}
