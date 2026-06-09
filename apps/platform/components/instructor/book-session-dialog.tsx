"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type BookSessionDialogProps = {
  studentId: string;
  studentEmail: string;
  sessionPackId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateTimeForInput(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours() + 1).padStart(2, "0");
  const minutes = String(0).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Dialog for instructors to manually book a session for a specific student.
 * Provides a datetime picker and optional notes field.
 *
 * @param studentId - Target student's ID
 * @param studentEmail - Target student's email (display only)
 * @param sessionPackId - Session pack ID to associate with the booking
 * @param open - Dialog open state
 * @param onOpenChange - Callback to update dialog open state
 * @param onSuccess - Optional callback fired after successful booking
 */
export function BookSessionDialog({ 
  studentId, 
  studentEmail, 
  sessionPackId, 
  open, 
  onOpenChange, 
  onSuccess 
}: BookSessionDialogProps) {
  const [scheduledAt, setScheduledAt] = useState(() => formatDateTimeForInput());
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function handleBook() {
    const scheduledAtMs = new Date(scheduledAt).getTime();
    if (isNaN(scheduledAtMs)) {
      toast.error("Invalid date/time selected");
      return;
    }

    if (scheduledAtMs <= Date.now()) {
      toast.error("Session must be scheduled in the future");
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch(`/api/instructor/students/${studentId}/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            scheduledAt: new Date(scheduledAt).toISOString(),
            sessionPackId,
            notes: notes.trim() || undefined,
          }),
        });
        const json = await res.json();
        
        if (!res.ok) {
          throw new Error(json.error || "Failed to book session");
        }

        toast.success("Session booked successfully");
        onOpenChange(false);
        setNotes("");
        router.refresh();
        onSuccess?.();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to book session");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Book New Session</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            <p><strong>Student:</strong> {studentEmail}</p>
          </div>
          <div className="space-y-2">
            <label htmlFor="session-datetime" className="text-sm font-medium">Date and Time</label>
            <input
              id="session-datetime"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="session-notes" className="text-sm font-medium">Notes (optional)</label>
            <Textarea
              id="session-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 500))}
              placeholder="Add notes about this session..."
              rows={3}
              maxLength={500}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleBook} disabled={isPending}>
            {isPending ? "Booking..." : "Book Session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}