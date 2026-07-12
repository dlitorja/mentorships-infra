"use client";

import { useState } from "react";
import { PhoneCall, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";

import { Button } from "@/components/ui/button";
import { ConsentModal } from "@/components/video/consent-modal";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexIdSchema } from "@/lib/validators";
import { reportError } from "@/lib/observability";
import type { UserRole } from "@/lib/auth-helpers";
import { useVideoCallContext } from "@/lib/video/video-context";

export type StartAdhocButtonProps = {
  workspaceId: Id<"workspaces">;
  role: UserRole;
};

const startAdhocResponseSchema = z.object({
  sessionId: convexIdSchema,
  roomName: z.string().min(1),
  roomUrl: z.string().url(),
});

/**
 * Instructor-only "Start ad-hoc call" button. The button itself is
 * hidden from students (parent component renders it conditionally
 * based on `role === "instructor"`) AND the API endpoint rejects
 * non-instructors server-side, so the constraint is enforced twice.
 *
 * Flow:
 *   1. Open the consent modal (default recording = ON per
 *      `docs/plans/video-calling.md:343`).
 *   2. On confirm, branch on the current session state:
 *
 *      a) No session exists for this workspace → POST
 *         /api/video/start-adhoc. The server creates the synthetic
 *         session row at `status: "scheduled"`, provisions the
 *         Daily room, and returns `{ sessionId, roomName, roomUrl }`.
 *
 *      b) Session exists at `status: "joinable"` (POST succeeded but
 *         `markCallStarted` failed previously, e.g. transient
 *         network blip) → call `markCallStarted` directly on the
 *         existing session. Re-POSTing would hit the active-call
 *         409 in `convex/sessions.startAdhocCall`. `markCallStarted`
 *         is idempotent — if `callStartedAt` is already set, it
 *         returns the existing value without throwing. The
 *         mutation throws `VIDEO_ROOM_NAME_CONFLICT` for orphan
 *         ad-hoc rows that never had a Daily room (caught below
 *         and surfaced as a toast; the user can refresh to trigger
 *         `startAdhocCall`'s self-heal cleanup on the next POST).
 *
 *   3. The `markCallStarted` mutation flips the row to
 *      `status: "active"`. The reactive
 *      `getCurrentOrUpcomingSessionForWorkspace` query refetches,
 *      `VideoCallProvider`'s auto-join effect (gated on
 *      `status === "active"`) fires, and the instructor transitions
 *      straight into the call without an intermediate Join gesture.
 *
 * Visibility:
 *   - Hides on `session.status === "active"` to prevent a second
 *     start attempt while the call is in progress.
 *   - Stays visible at `session.status === "joinable"` so the
 *     instructor can retry `markCallStarted` if it failed.
 *   - Hides once the call ends and the session query returns null.
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
  const markCallStarted = useMutation({
    mutationFn: useConvexMutation(api.sessions.markCallStarted),
  });

  if (role !== "instructor") {
    return null;
  }
  // Hide only once the call is active — leave the button visible at
  // `joinable` so a previous partial failure (POST ok, markCallStarted
  // threw) is recoverable: clicking again retries markCallStarted
  // directly instead of POSTing (which would 409).
  if (session?.status === "active") {
    return null;
  }

  const startAdhoc = async (recordingConsent: boolean): Promise<void> => {
    setIsStarting(true);
    try {
      // Branch (b): session already exists at "joinable" — retry the
      // markCallStarted flip without re-POSTing. Re-POSTing would
      // hit the active-candidate 409 in startAdhocCall because the
      // previous session row is still there.
      if (session?.status === "joinable") {
        await markCallStarted.mutateAsync({ sessionId: session.sessionId });
        return;
      }
      // Branch (a): no session yet — POST to create the synthetic row
      // and provision the Daily room.
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
      const body = startAdhocResponseSchema.parse(await res.json());
      await markCallStarted.mutateAsync({
        sessionId: body.sessionId as Id<"sessions">,
      });
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
    } finally {
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
