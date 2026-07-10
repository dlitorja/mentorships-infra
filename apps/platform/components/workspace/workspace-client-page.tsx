"use client";

import { useCallback, useState, useEffect } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { MessageSquare, PanelBottomOpen } from "lucide-react";
import { Id } from "../../../../convex/_generated/dataModel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Image as ImageIcon, Link as LinkIcon, Loader2, Info, X, FolderArchive } from "lucide-react";
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
import { WorkspaceDrawer } from "@/components/video/workspace-drawer";
import { WorkspaceRowBadge } from "@/components/workspace/workspace-row-badge";
import { useSplitRatio } from "@/lib/hooks/use-split-ratio";
import { useIsBelow } from "@/lib/hooks/use-media-query";
import { useVideoCallContext } from "@/lib/video/video-context";
import { DEFAULT_VERTICAL_SPLIT_RATIO, VERTICAL_SPLIT_RATIO_STORAGE_KEY } from "@/lib/video/constants";
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
}: {
  clerkUserId: string;
  workspaces: UserWorkspace[] | undefined;
  userRole: UserRole;
  selectedWorkspaceId: Id<"workspaces"> | null;
  onSelectWorkspace: (id: Id<"workspaces">) => void;
  activeTab: string;
  onChangeTab: (tab: string) => void;
  selectedWorkspace: UserWorkspace | undefined;
}) {
  const { session, status } = useVideoCallContext();
  // PR #4b: pass `sessionId` down to composers so posts during the
  // active call are auto-tagged. `null` outside an active call.
  const activeSessionId: Id<"sessions"> | null =
    session?.sessionId ?? null;
  // Phase 11: when an active call is in progress we pin the workspace
  // surface to the viewport height so the video + tab split can claim
  // 100% of the available vertical space. Outside a call we keep the
  // page in normal scroll flow so Notes / Images / Links don't get
  // clipped.
  const isInCall =
    status === "joined" || status === "joining" || status === "leaving";

  return (
    <div className={`container mx-auto p-4 md:p-6 ${isInCall ? "h-[calc(100dvh-64px)]" : ""}`}>
      <div className={`flex flex-col md:flex-row gap-6 ${isInCall ? "h-full" : ""}`}>
        <div className="w-full md:w-64 shrink-0">
          <Card className={isInCall ? "h-full" : ""}>
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
            <Card className={`flex flex-col ${isInCall ? "h-full" : ""}`}>
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
               * `<WaitingRoom>` self-hides when there are no waiters).
               * Phase 11: the tab strip now stays above the video split
               * so users can navigate Chat / Notes / Images / Links /
               * Resources during a call without losing the call. */}
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

              <CardContent className={isInCall ? "flex-1 min-h-0 pt-0 flex flex-col" : "pt-0"}>
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
                  className={`flex flex-col ${isInCall ? "h-full min-h-0" : ""}`}
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

                  {/* Phase 11: when an active call is in progress, the
                   * video panel sits in a vertical-stack split above the
                   * active tab content (rendered by `<TabContentWithVideo>`)
                   * so the call stays visible while the user navigates
                   * Notes / Images / Links / Resources. Outside a call
                   * we fall back to the plain tab content.
                   *
                   * Greptile P2 (Phase 11): Radix's `<TabsContent>` shim
                   * renders `role="tabpanel"` and links each `<TabsTrigger>`'s
                   * `aria-controls` to it. Phase 11 lifted the body out of
                   * `<TabsContent>` (so the same body can mount in three
                   * places — standalone, vertical stack bottom panel, drawer
                   * body), so we add `role="tabpanel"` + `aria-label`
                   * manually to keep the screen-reader association between
                   * trigger and content. */}
                  <div
                    role="tabpanel"
                    aria-label={activeTab}
                    className={isInCall ? "flex-1 min-h-0 mt-4" : "mt-4"}
                  >
                    <TabContentWithVideo
                      workspaceId={selectedWorkspace._id}
                      clerkUserId={clerkUserId}
                      role={userRole}
                      activeSessionId={activeSessionId}
                      activeTab={activeTab}
                    />
                  </div>
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
 * Phase 11: renders the workspace body for whichever tab the user
 * picked. Phase 11 lifts the body out of `<TabsContent>` so the same
 * component can mount either standalone (no call) or as the bottom
 * panel of the desktop vertical stack / the drawer body on phone.
 */
function TabContent({
  workspaceId,
  clerkUserId,
  role,
  activeSessionId,
  activeTab,
}: {
  workspaceId: Id<"workspaces">;
  clerkUserId: string;
  role: UserRole;
  activeSessionId: Id<"sessions"> | null;
  activeTab: string;
}): React.ReactElement {
  if (activeTab === "notes") {
    return (
      <WorkspaceNotes
        workspaceId={workspaceId}
        currentUserId={clerkUserId}
        activeSessionId={activeSessionId}
      />
    );
  }
  if (activeTab === "images") {
    return (
      <WorkspaceImages
        workspaceId={workspaceId}
        currentUserId={clerkUserId}
        role={role}
        activeSessionId={activeSessionId}
      />
    );
  }
  if (activeTab === "links") {
    return (
      <WorkspaceLinks
        workspaceId={workspaceId}
        currentUserId={clerkUserId}
        activeSessionId={activeSessionId}
      />
    );
  }
  if (activeTab === "resources") {
    if (role === "student") return <WorkspaceChat workspaceId={workspaceId} currentUserId={clerkUserId} role={role} activeSessionId={activeSessionId} />;
    return (
      <WorkspaceResources
        workspaceId={workspaceId}
        currentUserId={clerkUserId}
        role={role}
        activeSessionId={activeSessionId}
      />
    );
  }
  // Greptile P2 (Phase 11): an explicit chat branch surfaces the
  // default and keeps the activeTab-vs-renderer mapping in one place.
  // An unknown tab value falls through to chat (the historical default)
  // so a missing if-branch above still renders something useful rather
  // than a blank surface.
  return (
    <WorkspaceChat
      workspaceId={workspaceId}
      currentUserId={clerkUserId}
      role={role}
      activeSessionId={activeSessionId}
    />
  );
}

/**
 * Tab content with optional vertical-stack split for an active video
 * call. When no call is active, renders the active tab full-width.
 * When a call is active, splits vertically — video on top, active
 * tab on the bottom — so the call stays visible while the user
 * navigates Chat / Notes / Images / Links / Resources without
 * ending the call.
 *
 * Phase 11 breakpoint logic (vertical stack only on desktop):
 *   - ≥ 900px: vertical `<Group>` (video on top, active tab below)
 *     with a horizontal resizable divider. Persisted ratio lives
 *     under `VERTICAL_SPLIT_RATIO_STORAGE_KEY` (Phase 11 bumped the
 *     storage key from `video-call-split-ratio` to `:v2` so users
 *     who tuned the pre-Phase-11 horizontal split start at the new
 *     default instead of silently flipping the semantic).
 *   - 600–899px: active tab full-width + floating `<VideoPanel>` PiP.
 *   - < 600px: `<VideoPanel>` takes the full viewport; the active
 *     tab lives behind a `<WorkspaceDrawer>` bottom-sheet that the
 *     user opens via a "Workspace" button on the video chrome.
 *
 * Reading from `VideoCallContext` here instead of taking the session
 * as a prop keeps the "should we split?" decision inside the same
 * tree that knows whether the user has joined a call, without
 * plumbing through extra props.
 */
function TabContentWithVideo({
  workspaceId,
  clerkUserId,
  role,
  activeSessionId,
  activeTab,
}: {
  workspaceId: Id<"workspaces">;
  clerkUserId: string;
  role: UserRole;
  activeSessionId: Id<"sessions"> | null;
  activeTab: string;
}): React.ReactElement {
  const { status } = useVideoCallContext();
  const { ratio, setRatio } = useSplitRatio(
    VERTICAL_SPLIT_RATIO_STORAGE_KEY,
    DEFAULT_VERTICAL_SPLIT_RATIO
  );
  const videoSize = ratio;
  const tabSize = 100 - ratio;

  const isInCall =
    status === "joined" || status === "joining" || status === "leaving";

  // `useIsBelow` returns `null` on first render — resolve to false so
  // SSR paints the desktop branch on hydration. The first `change`
  // event swaps us into the right branch.
  const isPhone = useIsBelow(600);
  const isNarrow = useIsBelow(900);
  const isPhoneResolved = isPhone ?? false;
  const isNarrowResolved = isNarrow ?? false;

  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    if (!isPhoneResolved && drawerOpen) setDrawerOpen(false);
  }, [isPhoneResolved, drawerOpen]);

  const onLayoutChanged = useCallback(
    (layout: { [id: string]: number }) => {
      // Layout is keyed by panel id (id="video" and id="content").
      const videoPanelSize = layout["video"];
      if (typeof videoPanelSize === "number") {
        setRatio(videoPanelSize);
      }
    },
    [setRatio]
  );

  if (!isInCall) {
    return (
      <TabContent
        workspaceId={workspaceId}
        clerkUserId={clerkUserId}
        role={role}
        activeSessionId={activeSessionId}
        activeTab={activeTab}
      />
    );
  }

  if (isPhoneResolved) {
    return (
      <>
        <VideoPanel className="h-full" />
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={() => setDrawerOpen(true)}
          className="fixed top-3 right-3 z-50 h-10 w-10 rounded-full bg-background/90 shadow-lg backdrop-blur"
          aria-label="Open workspace"
          data-testid="workspace-drawer-open"
        >
          <PanelBottomOpen className="h-5 w-5" />
        </Button>
        <WorkspaceDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
        >
          <TabContent
            workspaceId={workspaceId}
            clerkUserId={clerkUserId}
            role={role}
            activeSessionId={activeSessionId}
            activeTab={activeTab}
          />
        </WorkspaceDrawer>
      </>
    );
  }

  if (isNarrowResolved) {
    return (
      <>
        <TabContent
          workspaceId={workspaceId}
          clerkUserId={clerkUserId}
          role={role}
          activeSessionId={activeSessionId}
          activeTab={activeTab}
        />
        <VideoPanel />
      </>
    );
  }

  // Desktop (≥ 900px): vertical stack — video on top, active tab below.
  return (
    <Group
      orientation="vertical"
      id={`workspace-${workspaceId}-video-tabs`}
      onLayoutChanged={onLayoutChanged}
      className="h-full"
    >
      <Panel id="video" defaultSize={videoSize} minSize={20}>
        <VideoPanel className="h-full" />
      </Panel>
      <Separator className="h-1.5 bg-border transition-colors hover:bg-primary" />
      <Panel id="content" defaultSize={tabSize} minSize={20}>
        <TabContent
          workspaceId={workspaceId}
          clerkUserId={clerkUserId}
          role={role}
          activeSessionId={activeSessionId}
          activeTab={activeTab}
        />
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
