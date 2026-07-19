"use client";

import { useState, useEffect, useMemo } from "react";
import { MessageSquare } from "lucide-react";
import { Id } from "../../../../convex/_generated/dataModel";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Info, X } from "lucide-react";
import WorkspaceChat from "@/components/workspace/chat";
import WorkspaceNotes from "@/components/workspace/notes";
import WorkspaceImages from "@/components/workspace/images";
import WorkspaceLinks from "@/components/workspace/links";
import WorkspaceResources from "@/components/workspace/resources";
import { RetentionWarningBanner } from "@/components/workspace/retention-warning-banner";
import { RecordingRetentionWarningBanner } from "@/components/workspace/recording-retention-warning-banner";
import { SessionCountControls } from "@/components/workspace/session-count-controls";
import { WorkspaceTabsList } from "@/components/workspace/workspace-tabs-list";
import { VideoCallProvider } from "@/components/video/video-call-provider";
import { CallStatusPill } from "@/components/video/call-status-pill";
import { CallOverlay } from "@/components/video/call-overlay";
import { StartAdhocButton } from "@/components/video/start-adhoc-button";
import { WaitingRoom } from "@/components/video/waiting-room";
import QuickCapture from "@/components/video/quick-capture";
import { WorkspaceRowBadge } from "@/components/workspace/workspace-row-badge";
import { useVideoCallContext, useIsInCall } from "@/lib/video/video-context";
import {
  ChatDataProvider,
  type ChatMessageRow,
} from "@/components/workspace/chat-data-context";
import { useWorkspaceMessages } from "@/lib/queries/convex/use-workspaces";
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

  // PR #4c-4: hoist the chat subscription so messages posted during
  // an active call flow into the overlay's chat panel without a
  // refresh. Previously `<WorkspaceChat>` only mounted inside the
  // `{!isInCall && <WorkspaceTabs />}` branch (which unmounts when a
  // call starts), then remounted inside `<CallOverlay>`'s portal.
  // The unmount/remount churn caused TanStack Query to drop its
  // observer count to zero mid-call and miss the next
  // `setQueryData` push from Convex — incoming messages appeared
  // only after a manual refresh. Hosting the subscription at the
  // `WorkspaceContent` level keeps at least one observer alive
  // throughout the workspace lifecycle.
  //
  // Hooks must be called BEFORE any conditional return (the loading
  // branch below), so `useWorkspaceMessages` and `useMemo` are
  // declared up here even when `workspacesLoading` is false.
  const messagesQuery = useWorkspaceMessages(selectedWorkspaceId);
  const chatDataValue = useMemo(
    () => ({
      workspaceId: selectedWorkspaceId,
      messages: messagesQuery.data as ChatMessageRow[] | undefined,
      isLoading: messagesQuery.isLoading,
    }),
    [selectedWorkspaceId, messagesQuery.data, messagesQuery.isLoading]
  );

  if (workspacesLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const selectedWorkspace = workspaces?.find((w: UserWorkspace) => w._id === selectedWorkspaceId);

  return (
    <ChatDataProvider value={chatDataValue}>
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
         *
         * CallOverlay mounts inside `WorkspaceInner` (where it has
         * access to the reactive `activeSessionId` from
         * `useVideoCallContext`). See the call site there for the
         * rationale on portal-to-document-body mounting.
         */}
        <QuickCapture />
      </VideoCallProvider>
    </ChatDataProvider>
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
  const { session } = useVideoCallContext();
  // PR #4b: pass `sessionId` down to composers so posts during the
  // active call are auto-tagged. `null` outside an active call.
  const activeSessionId: Id<"sessions"> | null =
    session?.sessionId ?? null;
  const isInCall = useIsInCall();
  // PR #4b-fix: confirm a workspace switch while a call is active.
  // `<VideoCallProvider>` is keyed by `selectedWorkspaceId`, so a
  // workspace change would otherwise unmount the Daily call
  // mid-session and silently end it for the remote participant.
  // The dialog intercepts the click when `isInCall` is true and
  // asks the user to confirm. Cancel closes the dialog without
  // switching; Continue proceeds to `onSelectWorkspace` (which
  // triggers the unmount + `endCall` via the hook's cleanup path).
  const [pendingSwitchTo, setPendingSwitchTo] = useState<Id<"workspaces"> | null>(null);
  // PR #3 follow-up: dismiss the confirmation automatically if the
  // call ends while the dialog is open (remote hangup, network drop).
  // Without this, the dialog would be stuck on a stale "Leave this
  // call to switch workspaces?" message after the call is already over.
  useEffect(() => {
    if (!isInCall) {
      setPendingSwitchTo(null);
    }
  }, [isInCall]);
  const requestSwitch = (id: Id<"workspaces">): void => {
    if (id === selectedWorkspaceId) return;
    if (isInCall) {
      setPendingSwitchTo(id);
      return;
    }
    onSelectWorkspace(id);
  };
  // Chat tab gets the viewport-locked inner-scroll layout: the page
  // container, sidebar card, workspace card, and `<TabsContent>` all
  // switch to fixed-height flex chains so the existing
  // `flex-1 overflow-y-auto` markup inside `chat.tsx` lights up. Other
  // tabs (Notes, Images, Links, Resources) keep natural page-scroll.
  // The active-call UI no longer affects this — `<CallOverlay />`
  // portals to `document.body` and owns its own height constraints.
  const useFullHeight = activeTab === "chat";

  return (
    <div className={`container mx-auto p-4 md:p-6 ${useFullHeight ? "h-[calc(100dvh-128px)]" : ""}`}>
      <div className={`flex flex-col md:flex-row gap-6 ${useFullHeight ? "h-full" : ""}`}>
        <div className="w-full md:w-64 shrink-0">
          <Card className={useFullHeight ? "h-full" : ""}>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Workspaces</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {workspaces && workspaces.length > 0 ? (
                <div className="space-y-1">
                  {workspaces.map((workspace: UserWorkspace) => (
                    <button
                      key={workspace._id}
                      onClick={() => requestSwitch(workspace._id)}
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

        {/* PR #3 follow-up: leave-call confirmation when switching
         * workspaces mid-call. Uses the standard Radix `<Dialog>`
         * so we get focus trap, Escape-to-dismiss, and initial
         * focus for free (CodeRabbit review). Controlled by
         * `pendingSwitchTo`; Escape and the overlay both close
         * without switching. `onOpenChange(false)` is what Radix
         * calls on Escape, on overlay click, and on the
         * `DialogClose` button. */}
        <Dialog
          open={pendingSwitchTo !== null}
          onOpenChange={(open) => {
            if (!open) setPendingSwitchTo(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Leave this call to switch workspaces?</DialogTitle>
              <DialogDescription>
                You are currently in a video call. Switching workspaces will end
                the call for both you and the other participant.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPendingSwitchTo(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  const target = pendingSwitchTo;
                  setPendingSwitchTo(null);
                  if (target) onSelectWorkspace(target);
                }}
              >
                Leave call and switch
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="flex-1 min-w-0">
          {selectedWorkspace ? (
            <Card className={`flex flex-col ${useFullHeight ? "h-full" : ""}`}>
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
                </div>
              </CardHeader>

              {/* Action row: call status pill + start call button
               * (instructor only) + session-count pill (instructor only)
               * + waiting-room admit control.
               * Hidden during an active call — `<CallOverlay />`
               * renders these surfaces in its own header, so we
               * avoid duplicate live instances (CodeRabbit review).
               * The card still renders its header so the user keeps
               * context about which workspace the call belongs to. */}
              {!isInCall && (
                <div className="px-6 pb-3 flex flex-wrap items-center gap-3 shrink-0">
                  <CallStatusPill />
                  {selectedWorkspace && userRole === "instructor" && (
                    <StartAdhocButton
                      workspaceId={selectedWorkspace._id}
                      role={userRole}
                    />
                  )}
                  {userRole === "instructor" && selectedWorkspace.sessionPackId && (
                    <SessionCountControls sessionPackId={selectedWorkspace.sessionPackId} />
                  )}
                  <WaitingRoom role={userRole} />
                </div>
              )}

              <CardContent className={useFullHeight ? "flex-1 min-h-0 pt-0 flex flex-col" : "pt-0"}>
                <WorkspacePolicyBanner />
                {selectedWorkspace.endedAt && (
                  <RetentionWarningBanner
                    workspaceId={selectedWorkspace._id}
                    endedAt={selectedWorkspace.endedAt}
                  />
                )}
                {/* R12: call-recording retention warnings. Mounted
                 * below the workspace banner because recordings
                 * are a sub-resource of the workspace. Mounted
                 * unconditionally (no `selectedWorkspace.endedAt`
                 * gate) because recordings expire on their own
                 * schedule, not when the workspace ends. */}
                <RecordingRetentionWarningBanner />
                {/* During an active call `<CallOverlay />` owns the
                 * `<Tabs>` subtree (mounted via portal). Rendering
                 * `<WorkspaceTabs />` here too would double-mount
                 * `<TabContent />` and trigger duplicate Convex
                 * subscriptions and effects (Greptile P2). */}
                {!isInCall && (
                  <WorkspaceTabs
                    workspaceId={selectedWorkspace._id}
                    clerkUserId={clerkUserId}
                    role={userRole}
                    activeSessionId={activeSessionId}
                    activeTab={activeTab}
                    onChangeTab={onChangeTab}
                    useFullHeight={useFullHeight}
                  />
                )}
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
      {/*
       * CallOverlay owns the call UI during an active call. It
       * portals to `document.body` and renders the Zoom-style
       * 70/30 horizontal split with the chat tabs on the right.
       * `activeTab` + `onChangeTab` are threaded through so the
       * overlay's tab strip stays in sync with the workspace's tab
       * state and the user's selection survives the end-of-call
       * unmount.
       */}
      {selectedWorkspaceId && (
        <CallOverlay
          workspaceId={selectedWorkspaceId}
          clerkUserId={clerkUserId}
          role={userRole}
          activeSessionId={activeSessionId}
          activeTab={activeTab}
          onChangeTab={onChangeTab}
        />
      )}
    </div>
  );
}

/**
 * Renders the workspace body for whichever tab the user picked.
 * Centralizes the `activeTab` → workspace-component mapping so the
 * `<TabsContent>` body in the workspace view and the overlay's
 * `<TabsContent>` body share one switch (instead of two parallel
 * `<TabsContent>` blocks). Exported so `<CallOverlay />` can reuse
 * the exact same mapping for its right-panel tabs.
 */
export function TabContent({
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
 * Renders the `<Tabs>` subtree for the workspace view (no active
 * call). The call UI lives in `<CallOverlay />` which portals to
 * `document.body` and renders its own `<Tabs>` subtree during an
 * active call. Sharing `TabContent` and `WorkspaceTabsList` between
 * the two surfaces keeps the activeTab → component mapping and the
 * trigger strip in one place each.
 */
function WorkspaceTabs({
  workspaceId,
  clerkUserId,
  role,
  activeSessionId,
  activeTab,
  onChangeTab,
  useFullHeight,
}: {
  workspaceId: Id<"workspaces">;
  clerkUserId: string;
  role: UserRole;
  activeSessionId: Id<"sessions"> | null;
  activeTab: string;
  onChangeTab: (tab: string) => void;
  useFullHeight: boolean;
}): React.ReactElement {
  return (
    <Tabs
      value={activeTab}
      onValueChange={onChangeTab}
      className={useFullHeight ? "flex flex-col h-full min-h-0" : "flex flex-col"}
    >
      <WorkspaceTabsList role={role} />
      <TabsContent
        value={activeTab}
        className={useFullHeight ? "flex-1 min-h-0 mt-4" : "mt-4"}
      >
        <TabContent
          workspaceId={workspaceId}
          clerkUserId={clerkUserId}
          role={role}
          activeSessionId={activeSessionId}
          activeTab={activeTab}
        />
      </TabsContent>
    </Tabs>
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
