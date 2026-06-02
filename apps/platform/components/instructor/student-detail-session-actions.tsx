"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Calendar, X, FileText } from "lucide-react";

type Session = {
  id: string;
  scheduledAt: number;
  studentEmail?: string | null;
  notes?: string | null;
  status: string;
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

export function StudentDetailRescheduleDialog({ session, open, onOpenChange, onSuccess }: RescheduleDialogProps) {
  const [newDateTime, setNewDateTime] = useState(() => formatDateForInput(session.scheduledAt));
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();

  async function handleReschedule() {
    const newScheduledAt = new Date(newDateTime).getTime();
    if (isNaN(newScheduledAt)) {
      toast.error("Invalid date/time selected");
      return;
    }

    setIsPending(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newScheduledAt }),
      });
      const json = await res.json();
      
      if (!res.ok) {
        throw new Error(json.error || "Failed to reschedule");
      }

      toast.success("Session rescheduled.");
      onOpenChange(false);
      router.refresh();
      onSuccess?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reschedule session");
    } finally {
      setIsPending(false);
    }
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

export function StudentDetailCancelDialog({ session, open, onOpenChange, onSuccess }: CancelDialogProps) {
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();

  async function handleCancel() {
    setIsPending(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      const json = await res.json();
      
      if (!res.ok) {
        throw new Error(json.error || "Failed to cancel");
      }

      toast.success("Session canceled.");
      onOpenChange(false);
      setReason("");
      router.refresh();
      onSuccess?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel session");
    } finally {
      setIsPending(false);
    }
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

export function StudentDetailNotesDialog({ session, open, onOpenChange, onSuccess }: NotesDialogProps) {
  const [notes, setNotes] = useState(session.notes ?? "");
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();

  async function handleSave() {
    setIsPending(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes.trim() }),
      });
      const json = await res.json();
      
      if (!res.ok) {
        throw new Error(json.error || "Failed to save notes");
      }

      toast.success("Notes saved");
      onOpenChange(false);
      router.refresh();
      onSuccess?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save notes");
    } finally {
      setIsPending(false);
    }
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

type StudentDetailSessionActionsProps = {
  session: Session;
  onSessionUpdated?: () => void;
  allowedActions?: Array<"reschedule" | "cancel" | "notes">;
};

export function StudentDetailSessionActions({ session, onSessionUpdated, allowedActions }: StudentDetailSessionActionsProps) {
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

      <StudentDetailRescheduleDialog
        session={session}
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
        onSuccess={onSessionUpdated}
      />
      <StudentDetailCancelDialog
        session={session}
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        onSuccess={onSessionUpdated}
      />
      <StudentDetailNotesDialog
        session={session}
        open={notesOpen}
        onOpenChange={setNotesOpen}
        onSuccess={onSessionUpdated}
      />
    </>
  );
}