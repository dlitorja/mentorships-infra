"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Calendar, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentInstructor } from "@/lib/queries/convex";
import {
  useRescheduleSession,
  useCancelSession,
  useUpdateSessionNotes,
} from "@/lib/queries/use-session-actions";
import {
  formatUtcMillisForDateTimeLocal,
  isValidTimeZone,
  parseDateTimeLocalToUtcMillis,
} from "@/lib/timezone";
import { EmailPreviewTab } from "./email-preview-tab";

export type SessionActionSession = {
  id: string;
  scheduledAt: number;
  studentEmail?: string | null;
  notes?: string | null;
  status?: string;
};

function formatDateTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

type RescheduleDialogProps = {
  session: SessionActionSession;
  timeZone: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

function RescheduleSessionDialog({
  session,
  timeZone,
  open,
  onOpenChange,
  onSuccess,
}: RescheduleDialogProps) {
  const [newDateTime, setNewDateTime] = useState(() =>
    formatUtcMillisForDateTimeLocal(timeZone, session.scheduledAt)
  );
  const { mutate, isPending } = useRescheduleSession();
  const router = useRouter();

  useEffect(() => {
    if (open) {
      setNewDateTime(formatUtcMillisForDateTimeLocal(timeZone, session.scheduledAt));
    }
    // Only reinitialize when the dialog opens; the timezone is guaranteed to be
    // loaded before the dialog can open because the trigger button is disabled
    // until useCurrentInstructor resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleReschedule() {
    const newScheduledAt = parseDateTimeLocalToUtcMillis(timeZone, newDateTime);
    if (newScheduledAt === null) {
      toast.error("Invalid date/time selected for the selected timezone");
      return;
    }

    mutate(
      { sessionId: session.id, newScheduledAt },
      {
        onSuccess: () => {
          toast.success("Session rescheduled.");
          onOpenChange(false);
          router.refresh();
          onSuccess?.();
        },
        onError: (e) => {
          toast.error(e instanceof Error ? e.message : "Failed to reschedule session");
        },
      }
    );
  }

  const newScheduledAtMs = parseDateTimeLocalToUtcMillis(timeZone, newDateTime);

  const actionContent = (
    <>
      <div className="space-y-4">
        <div className="text-sm text-muted-foreground">
          <p>
            <strong>Student:</strong> {session.studentEmail ?? "Unknown"}
          </p>
          <p>
            <strong>Current time:</strong> {formatDateTime(session.scheduledAt)}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-datetime">New date and time</Label>
          <Input
            id="new-datetime"
            type="datetime-local"
            value={newDateTime}
            onChange={(e) => setNewDateTime(e.target.value)}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={handleReschedule} disabled={isPending}>
          {isPending ? "Rescheduling..." : "Reschedule"}
        </Button>
      </DialogFooter>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reschedule Session</DialogTitle>
          <DialogDescription>
            Choose a new date and time for the session. The student will be notified.
          </DialogDescription>
        </DialogHeader>
        <EmailPreviewTab
          sessionId={session.id}
          previewType="reschedule"
          newScheduledAt={
            newScheduledAtMs !== null ? newScheduledAtMs : undefined
          }
          actionContent={actionContent}
        />
      </DialogContent>
    </Dialog>
  );
}

type CancelDialogProps = {
  session: SessionActionSession;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

function CancelSessionDialog({
  session,
  open,
  onOpenChange,
  onSuccess,
}: CancelDialogProps) {
  const [reason, setReason] = useState("");
  const { mutate, isPending } = useCancelSession();
  const router = useRouter();

  useEffect(() => {
    if (open) {
      setReason("");
    }
  }, [open]);

  function handleCancel() {
    mutate(
      { sessionId: session.id, reason: reason.trim() || undefined },
      {
        onSuccess: () => {
          toast.success("Session canceled.");
          onOpenChange(false);
          setReason("");
          router.refresh();
          onSuccess?.();
        },
        onError: (e) => {
          toast.error(e instanceof Error ? e.message : "Failed to cancel session");
        },
      }
    );
  }

  const actionContent = (
    <>
      <div className="space-y-4">
        <div className="text-sm text-muted-foreground">
          <p>
            <strong>Student:</strong> {session.studentEmail ?? "Unknown"}
          </p>
          <p>
            <strong>Scheduled time:</strong> {formatDateTime(session.scheduledAt)}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="cancel-reason">Reason (optional)</Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            placeholder="Let the student know why the session is being canceled..."
            rows={3}
            maxLength={500}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Keep Session
        </Button>
        <Button variant="destructive" onClick={handleCancel} disabled={isPending}>
          {isPending ? "Canceling..." : "Cancel Session"}
        </Button>
      </DialogFooter>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel Session</DialogTitle>
          <DialogDescription>
            Optionally add a reason. The student will be notified.
          </DialogDescription>
        </DialogHeader>
        <EmailPreviewTab
          sessionId={session.id}
          previewType="cancel"
          reason={reason}
          actionContent={actionContent}
        />
      </DialogContent>
    </Dialog>
  );
}

type NotesDialogProps = {
  session: SessionActionSession;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

function SessionNotesDialog({
  session,
  open,
  onOpenChange,
  onSuccess,
}: NotesDialogProps) {
  const [notes, setNotes] = useState(session.notes ?? "");
  const { mutate, isPending } = useUpdateSessionNotes();
  const router = useRouter();

  useEffect(() => {
    if (open) {
      setNotes(session.notes ?? "");
    }
  }, [open, session.notes]);

  function handleSave() {
    mutate(
      { sessionId: session.id, notes: notes.trim() },
      {
        onSuccess: () => {
          toast.success("Notes saved");
          onOpenChange(false);
          router.refresh();
          onSuccess?.();
        },
        onError: (e) => {
          toast.error(e instanceof Error ? e.message : "Failed to save notes");
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Session Notes</DialogTitle>
          <DialogDescription>
            Add or update private notes about this session.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            <p>
              <strong>Student:</strong> {session.studentEmail ?? "Unknown"}
            </p>
            <p>
              <strong>Session:</strong> {formatDateTime(session.scheduledAt)}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="session-notes">Notes</Label>
            <Textarea
              id="session-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
              placeholder="Add notes about this session..."
              rows={5}
              maxLength={1000}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? "Saving..." : "Save Notes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type SessionActionsProps = {
  session: SessionActionSession;
  onSessionUpdated?: () => void;
  allowedActions?: Array<"reschedule" | "cancel" | "notes">;
};

export function SessionActions({
  session,
  onSessionUpdated,
  allowedActions,
}: SessionActionsProps) {
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const {
    data: instructor,
    isLoading: isLoadingTimeZone,
    isError: isTimeZoneError,
  } = useCurrentInstructor();
  const rawTimeZone = instructor?.timeZone;
  const timeZone = isValidTimeZone(rawTimeZone ?? "UTC") ? rawTimeZone! : "UTC";
  const hasValidTimeZone = rawTimeZone != null && isValidTimeZone(rawTimeZone);
  const canLoadTimeZone = !isLoadingTimeZone && !isTimeZoneError && hasValidTimeZone;

  const canReschedule = !allowedActions || allowedActions.includes("reschedule");
  const canCancel = !allowedActions || allowedActions.includes("cancel");
  const canNotes = !allowedActions || allowedActions.includes("notes");

  return (
    <>
      <div className="flex items-center gap-1">
        {canReschedule && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRescheduleOpen(true)}
            title={
              isTimeZoneError
                ? "Unable to load your timezone. Please refresh and try again."
                : !hasValidTimeZone
                  ? "Set your timezone in settings before rescheduling sessions."
                  : "Reschedule"
            }
            aria-label="Reschedule session"
            disabled={!canLoadTimeZone}
          >
            <Calendar className="h-4 w-4" />
          </Button>
        )}
        {canCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCancelOpen(true)}
            title="Cancel"
            aria-label="Cancel session"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
        {canNotes && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setNotesOpen(true)}
            title="Notes"
            aria-label="Session notes"
          >
            <FileText className="h-4 w-4" />
          </Button>
        )}
      </div>

      <RescheduleSessionDialog
        session={session}
        timeZone={timeZone}
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
        onSuccess={onSessionUpdated}
      />
      <CancelSessionDialog
        session={session}
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        onSuccess={onSessionUpdated}
      />
      <SessionNotesDialog
        session={session}
        open={notesOpen}
        onOpenChange={setNotesOpen}
        onSuccess={onSessionUpdated}
      />
    </>
  );
}
