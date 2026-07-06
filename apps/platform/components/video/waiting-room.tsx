"use client";

import { useWaitingParticipants } from "@daily-co/daily-react";
import { UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { reportError } from "@/lib/observability";
import type { UserRole } from "@/lib/auth-helpers";

export type WaitingRoomProps = {
  /**
   * Pass `role === "instructor"` to enable the admit/deny controls.
   * Students never see this component (parent gates the mount), so
   * even if rendered with `role === "student"` the controls are
   * disabled and the list is shown as read-only.
   */
  role: UserRole;
};

/**
 * Instructor-side waiting-room control.
 *
 * Daily's `enable_knocking: true` (added in PR #4a to `createDailyRoom`)
 * places late-joining participants in a lobby instead of rejecting
 * them when `max_participants: 2` is hit. This component reads the
 * current waiting list via `useWaitingParticipants` and exposes
 * admit/deny buttons.
 *
 * Mount rules:
 *   - Only renders anything if there is at least one waiting
 *     participant (otherwise an empty banner would be noise).
 *   - Only admits/denies when `role === "instructor"` — matches the
 *     endpoint gate (Daily's `grantAccess` would no-op for non-owners
 *     anyway, but we hide the UI for clarity).
 *
 * Why no busy/spinner state: Daily's `grantAccess`/`denyAccess` are
 * synchronous SDK calls that update the meeting state immediately.
 * With React 18 automatic batching, any `useState` flip around a
 * synchronous call collapses into a single render — so the spinner
 * never appears. The participant is removed from the list as soon as
 * Daily's `waiting-participant-removed` event fires (which the
 * `useWaitingParticipants` hook handles), giving the user natural
 * feedback that the action completed.
 */
export function WaitingRoom({ role }: WaitingRoomProps): React.ReactElement | null {
  const { waitingParticipants, grantAccess, denyAccess } = useWaitingParticipants();

  if (waitingParticipants.length === 0) {
    return null;
  }

  const isInstructor = role === "instructor";

  const handleAdmit = async (id: string, name: string): Promise<void> => {
    try {
      grantAccess(id);
      toast.success(`Admitted ${name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await reportError({
        source: "WaitingRoom.handleAdmit",
        error: err instanceof Error ? err : new Error(message),
        level: "error",
        message: "Failed to admit waiting participant",
        context: { participantId: id },
      });
      toast.error("Could not admit participant", { description: message });
    }
  };

  const handleDeny = async (id: string, name: string): Promise<void> => {
    try {
      denyAccess(id);
      toast.message(`${name} was denied`, { description: "They'll see a call-ended message." });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await reportError({
        source: "WaitingRoom.handleDeny",
        error: err instanceof Error ? err : new Error(message),
        level: "error",
        message: "Failed to deny waiting participant",
        context: { participantId: id },
      });
      toast.error("Could not deny participant", { description: message });
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card px-3 py-2 text-sm shadow-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium">Waiting room</span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          {waitingParticipants.length} waiting
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {waitingParticipants.map((p) => {
          const id = typeof p.id === "string" ? p.id : String(p.id);
          const name =
            typeof p.user_name === "string" && p.user_name.length > 0
              ? p.user_name
              : "Guest";
          return (
            <li
              key={id}
              className="flex items-center justify-between gap-2 rounded border bg-background px-2 py-1.5"
            >
              <span className="truncate text-sm">{name}</span>
              {isInstructor ? (
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleDeny(id, name)}
                    aria-label={`Deny ${name}`}
                  >
                    <UserX className="h-3 w-3" />
                    Deny
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={() => void handleAdmit(id, name)}
                    aria-label={`Admit ${name}`}
                  >
                    <UserCheck className="h-3 w-3" />
                    Admit
                  </Button>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">Read-only</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
