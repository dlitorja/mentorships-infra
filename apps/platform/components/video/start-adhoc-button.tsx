"use client";

import { useState } from "react";
import { PhoneCall, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConsentModal } from "@/components/video/consent-modal";
import type { Id } from "@/convex/_generated/dataModel";
import { reportError } from "@/lib/observability";
import type { UserRole } from "@/lib/auth-helpers";

export type StartAdhocButtonProps = {
  workspaceId: Id<"workspaces">;
  role: UserRole;
};

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
 *      consent value. Server creates the synthetic session + Daily
 *      room and returns `{ sessionId, roomName, roomUrl }`.
 *   3. The VideoCallProvider subscribes to the workspace's session
 *      via `getCurrentOrUpcomingSessionForWorkspace` (PR #3). The
 *      synthetic row has DB `status: "scheduled"` with `scheduledAt ≈
 *      now` and a populated `videoRoomName`; the query returns it as
 *      `"joinable"`, so the existing auto-join effect kicks in.
 *
 * Notification to the student is deferred — instructor tells them
 * manually for now; email + in-app notification are PR #5+ work.
 */
export function StartAdhocButton({
  workspaceId,
  role,
}: StartAdhocButtonProps): React.ReactElement | null {
  const [modalOpen, setModalOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  if (role !== "instructor") {
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
      // Provider picks up the new session via the existing PR #3
      // subscription; no client-side join dispatch needed. Reset both
      // flags so the button is enabled again if the instructor wants
      // to start another ad-hoc call later in this session.
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
