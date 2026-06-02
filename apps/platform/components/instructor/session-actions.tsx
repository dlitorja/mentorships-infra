"use client";

import { useState, useTransition } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Calendar, X, FileText } from "lucide-react";

type Session = {
  id: Id<"sessions">;
  scheduledAt: number;
  studentEmail: string | null;
  notes?: string | null;
};

type RescheduleDialogProps = {
  session: Session;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
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
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  const year = localDate.getFullYear();
  const month = String(localDate.getMonth() + 1).padStart(2, "0");
  const day = String(localDate.getDate()).padStart(2, "0");
  const hours = String(localDate.getHours()).padStart(2, "0");
  const minutes = String(localDate.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function RescheduleSessionDialog({ session, open, onOpenChange, onSuccess }: RescheduleDialogProps) {
  const [newDateTime, setNewDateTime] = useState(() => formatDateForInput(session.scheduledAt));
  const [isPending, startTransition] = useTransition();
  const reschedule = useMutation(api.sessions.rescheduleSession);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reschedule Session</DialogTitle>
        </DialogHeader>
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
          <p className="text-xs text-muted-foreground">
            The student will be notified of this change via email.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleReschedule} disabled={isPending}>
            {isPending ? "Rescheduling..." : "Reschedule"}
          </Button>
        </DialogFooter>
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

export function CancelSessionDialog({ session, open, onOpenChange, onSuccess }: CancelDialogProps) {
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const cancel = useMutation(api.sessions.cancelSession);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel Session</DialogTitle>
        </DialogHeader>
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
          <p className="text-xs text-muted-foreground">
            The student will be notified of this cancellation via email.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Keep Session</Button>
          <Button variant="destructive" onClick={handleCancel} disabled={isPending}>
            {isPending ? "Canceling..." : "Cancel Session"}
          </Button>
        </DialogFooter>
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

export function SessionNotesDialog({ session, open, onOpenChange, onSuccess }: NotesDialogProps) {
  const [notes, setNotes] = useState(session.notes ?? "");
  const [isPending, startTransition] = useTransition();
  const updateNotes = useMutation(api.sessions.updateSessionNotes);

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
};

export function SessionActions({ session, onSessionUpdated }: SessionActionsProps) {
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRescheduleOpen(true)}
          title="Reschedule"
        >
          <Calendar className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCancelOpen(true)}
          title="Cancel"
        >
          <X className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setNotesOpen(true)}
          title="Notes"
        >
          <FileText className="h-4 w-4" />
        </Button>
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