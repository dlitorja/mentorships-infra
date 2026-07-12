"use client";

import { useState } from "react";
import { PhoneCall, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";

import { Button } from "@/components/ui/button";
import { ConsentModal } from "@/components/video/consent-modal";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { reportError } from "@/lib/observability";
import type { UserRole } from "@/lib/auth-helpers";
import { useVideoCallContext } from "@/lib/video/video-context";

export type StartAdhocButtonProps = {
  workspaceId: Id<"workspaces">;
  role: UserRole;
};

interface StartAdhocSuccess {
  sessionId: string;
  roomName: string;
  roomUrl: string;
}

/**
 * Instructor-only "Start ad-hoc call" button. The button itself is
 * hidden from students (parent component renders it conditionally
 * based on `role === "instructor"`) AND the API endpoint rejects
 * non-instructors server-side, so the constraint is enforced twice.
 *
 * Flow:
 *   1. Open the consent modal (default recording = ON per
 *      `docs/plans/video-calling.md:343`).
 *   2. On confirm: POST /api/video/start-adhoc with the chosen
 *      consent value. The server creates the synthetic session row
 *      at `status: "scheduled"`, provisions the Daily room, and
 *      returns `{ sessionId, roomName, roomUrl }`.
 *   3. Call `markCallStarted` to flip the row to `status: "active"`.
 *      The reactive `getCurrentOrUpcomingSessionForWorkspace` query
 *      refetches, `VideoCallProvider`'s auto-join effect (gated on
 *      `status === "active"`) fires, and the instructor transitions
 *      straight into the call without an intermediate Join gesture.
 *
 * The button hides itself whenever `useVideoCallContext().session`
 * is non-null (a joinable or active session exists for this
 * workspace), so a second click while a call is in progress is
 * impossible from the UI. This prevents the active-candidate 409
 * thrown by `convex/sessions.startAdhocCall` (`isAdhoc === true`
 * guard). The button reappears once the call ends and the
 * workspace's session query returns null.
 *
 * Notification to the student is deferred via `after()` in the
 * route handler (in-app notification row + Trigger.dev email).
 */
export function StartAdhocButton({
  workspaceId,
  role,
}: StartAdhocButtonProps): React.ReactElement | null {
  const [modalOpen, setModalOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const { session } = useVideoCallContext();
  const queryClient = useQueryClient();
  const markCallStarted = useMutation({
    mutationFn: useConvexMutation(api.sessions.markCallStarted),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  if (role !== "instructor") {
    return null;
  }
  if (session !== null) {
    return null;
  }

  const startAdhoc = async (recordingConsent: boolean): Promise<void> => {
    setIsStarting(true);
    try {
      const res = await fetch("/api/video/start-adhoc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, recordingConsent }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          `Failed to start ad-hoc call (${res.status})${detail ? `: ${detail}` : ""}`
        );
      }
      const body = (await res.json()) as StartAdhocSuccess;
      // Flip the row to "active" so VideoCallProvider's auto-join
      // effect (gated on status === "active") fires. Mirrors the
      // joinable → active path in VideoCallProvider.joinCall but
      // skips the manual Join Call gesture since the instructor
      // explicitly invoked Start.
      await markCallStarted.mutateAsync({
        sessionId: body.sessionId as Id<"sessions">,
      });
      setIsStarting(false);
      setModalOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await reportError({
        source: "StartAdhocButton",
        error: err instanceof Error ? err : new Error(message),
        level: "error",
        message: "Failed to start ad-hoc call",
        context: { workspaceId, recordingConsent },
      });
      toast.error("Could not start ad-hoc call", { description: message });
      setIsStarting(false);
      // Close the modal so the next open gets a fresh `hasChosen=false`
      // (the ConsentModal only resets on `open` flipping to true).
      setModalOpen(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setModalOpen(true)}
        disabled={isStarting}
      >
        {isStarting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <PhoneCall className="h-4 w-4" />
        )}
        Start ad-hoc call
      </Button>
      <ConsentModal
        open={modalOpen}
        defaultRecording={true}
        onResolved={(consent) => {
          void startAdhoc(consent);
        }}
        onCancel={() => {
          setModalOpen(false);
          setIsStarting(false);
        }}
      />
    </>
  );
}
