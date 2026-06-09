"use client";

import { useState, useTransition, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Calendar, X, FileText } from "lucide-react";
import { EmailPreviewTab } from "./email-preview-tab";

type Session = {
  id: Id<"sessions">;
  scheduledAt: number;
  studentEmail: string | null;
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

function formatDateForInput(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

type RescheduleDialogProps = {
  session: Session;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

/**
 * Dialog for rescheduling a session to a new date/time.
 * Shows an email preview of the reschedule notification before confirming.
 *
 * @param session - Session object with id, scheduledAt, studentEmail
 * @param open - Dialog open state
 * @param onOpenChange - Callback to update dialog open state
 * @param onSuccess - Optional callback fired after successful reschedule
 */
export function RescheduleSessionDialog({ session, open, onOpenChange, onSuccess }: RescheduleDialogProps) {
  const [newDateTime, setNewDateTime] = useState(() => formatDateForInput(session.scheduledAt));
  const [isPending, startTransition] = useTransition();
  const reschedule = useMutation(api.sessions.rescheduleSession);

  useEffect(() => {
    if (open) {
      setNewDateTime(formatDateForInput(session.scheduledAt));
    }
  }, [open, session.scheduledAt]);

  async function handleReschedule() {
    const newScheduledAt = new Date(newDateTime).getTime();
    if (isNaN(newScheduledAt)) {
      toast.error("Invalid date/time selected");
      return;
    }

    startTransition(async () => {
      try {
        await reschedule({ 
          id: session.id, 
          newScheduledAt,
        });
        toast.success("Session rescheduled.");
        onOpenChange(false);
        onSuccess?.();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to reschedule session");
      }
    });
  }

  const newScheduledAtMs = new Date(newDateTime).getTime();

  const actionContent = (
    <>
      <div className="space-y-4">
        <div className="text-sm text-muted-foreground">
          <p><strong>Student:</strong> {session.studentEmail ?? "Unknown"}</p>
          <p><strong>Current time:</strong> {formatDateTime(session.scheduledAt)}</p>
        </div>
        <div className="space-y-2">
          <label htmlFor="new-datetime" className="text-sm font-medium">New date and time</label>
          <input
            id="new-datetime"
            type="datetime-local"
            value={newDateTime}
            onChange={(e) => setNewDateTime(e.target.value)}
            className="w-full px-3 py-2 border rounded-md text-sm"
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
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
        </DialogHeader>
        <EmailPreviewTab
          sessionId={session.id}
          previewType="reschedule"
          newScheduledAt={!isNaN(newScheduledAtMs) ? newScheduledAtMs : undefined}
          actionContent={actionContent}
        />
      </DialogContent>
    </Dialog>
  );
}

type CancelDialogProps = {
  session: Session;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

/**
 * Dialog for canceling a session with an optional reason.
 * Shows an email preview of the cancellation notification before confirming.
 *
 * @param session - Session object with id, scheduledAt, studentEmail
 * @param open - Dialog open state
 * @param onOpenChange - Callback to update dialog open state
 * @param onSuccess - Optional callback fired after successful cancellation
 */
export function CancelSessionDialog({ session, open, onOpenChange, onSuccess }: CancelDialogProps) {
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const cancel = useMutation(api.sessions.cancelSession);

  useEffect(() => {
    if (open) {
      setReason("");
    }
  }, [open]);

  async function handleCancel() {
    startTransition(async () => {
      try {
        await cancel({ 
          id: session.id, 
          reason: reason.trim() || undefined,
        });
        toast.success("Session canceled.");
        onOpenChange(false);
        setReason("");
        onSuccess?.();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to cancel session");
      }
    });
  }

  const actionContent = (
    <>
      <div className="space-y-4">
        <div className="text-sm text-muted-foreground">
          <p><strong>Student:</strong> {session.studentEmail ?? "Unknown"}</p>
          <p><strong>Scheduled time:</strong> {formatDateTime(session.scheduledAt)}</p>
        </div>
        <div className="space-y-2">
          <label htmlFor="cancel-reason" className="text-sm font-medium">Reason (optional)</label>
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
        <Button variant="outline" onClick={() => onOpenChange(false)}>Keep Session</Button>
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
  session: Session;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

/**
 * Dialog for adding or editing notes on a session.
 * Notes are only visible to the instructor.
 *
 * @param session - Session object with id, scheduledAt, studentEmail, and existing notes
 * @param open - Dialog open state
 * @param onOpenChange - Callback to update dialog open state
 * @param onSuccess - Optional callback fired after successful save
 */
export function SessionNotesDialog({ session, open, onOpenChange, onSuccess }: NotesDialogProps) {
  const [notes, setNotes] = useState(session.notes ?? "");
  const [isPending, startTransition] = useTransition();
  const updateNotes = useMutation(api.sessions.updateSessionNotes);

  useEffect(() => {
    if (open) {
      setNotes(session.notes ?? "");
    }
  }, [open, session.notes]);

  async function handleSave() {
    startTransition(async () => {
      try {
        await updateNotes({ 
          id: session.id, 
          notes: notes.trim(),
        });
        toast.success("Notes saved");
        onOpenChange(false);
        onSuccess?.();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to save notes");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Session Notes</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            <p><strong>Student:</strong> {session.studentEmail ?? "Unknown"}</p>
            <p><strong>Session:</strong> {formatDateTime(session.scheduledAt)}</p>
          </div>
          <div className="space-y-2">
            <label htmlFor="session-notes" className="text-sm font-medium">Notes</label>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? "Saving..." : "Save Notes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type SessionActionsProps = {
  session: Session;
  onSessionUpdated?: () => void;
  allowedActions?: Array<"reschedule" | "cancel" | "notes">;
};

/**
 * Action menu for a session with reschedule, cancel, and notes dialogs.
 * Renders icon buttons that open the appropriate dialogs.
 *
 * @param session - Session object with id, scheduledAt, studentEmail, notes
 * @param onSessionUpdated - Optional callback fired after any action modifies the session
 * @param allowedActions - Optional list of permitted actions (defaults to all)
 */
export function SessionActions({ session, onSessionUpdated, allowedActions }: SessionActionsProps) {
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

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
            title="Reschedule"
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
          >
            <FileText className="h-4 w-4" />
          </Button>
        )}
      </div>

      <RescheduleSessionDialog
        session={session}
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