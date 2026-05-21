"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type BookingStatus = "pending" | "confirmed" | "canceled" | "completed";
type Booking = { id: string; startUtc: number; endUtc: number; studentEmail: string; status: BookingStatus };

function formatDateTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

export function InstructorBookingsList({ initial }: { initial: Booking[] }) {
  const [bookings, setBookings] = useState<Booking[]>(initial);
  const [inFlightId, setInFlightId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [completeOpenId, setCompleteOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState<string>("");

  async function cancel(id: string) {
    if (!confirm("Cancel this booking?")) return;
    setInFlightId(id);
    try {
      const res = await fetch(`/api/bookings/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.success) {
        startTransition(() => setBookings((prev) => prev.filter((b) => b.id !== id)));
        toast.success("Booking canceled");
      } else {
        toast.error(json?.error || "Failed to cancel booking");
      }
    } catch (e) {
      toast.error("Unexpected error while cancelling");
    } finally {
      setInFlightId(null);
    }
  }

  async function submitComplete(id: string, optNotes?: string): Promise<boolean> {
    setInFlightId(id);
    try {
      const res = await fetch(`/api/bookings/${id}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: optNotes || undefined }) });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.success) {
        setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status: "completed" } : b)));
        toast.success("Session marked as completed");
        return true;
      } else {
        toast.error(json?.error || "Failed to mark completed");
        return false; // avoid duplicate error toast
      }
    } catch (e) {
      toast.error("Unexpected error while marking completed");
      return false;
    } finally {
      setInFlightId(null);
    }
  }

  if (bookings.length === 0) {
    return <div className="text-center py-8 text-muted-foreground"><p>No bookings yet</p></div>;
  }

  return (
    <div className="space-y-3">
      {bookings.map((b) => (
        <div key={b.id} className="border rounded-lg p-3 flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">{formatDateTime(b.startUtc)}</div>
            <div className="text-xs text-muted-foreground">{b.studentEmail}</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={b.status === "confirmed" ? "secondary" : b.status === "completed" ? "default" : b.status === "canceled" ? "destructive" : "outline"}>{b.status}</Badge>
            {b.status === "confirmed" && b.startUtc < Date.now() && (
              <Button variant="ghost" size="sm" onClick={() => { setCompleteOpenId(b.id); setNotes(""); }} disabled={inFlightId === b.id}>
                Mark completed
              </Button>
            )}
            {b.status === "confirmed" && b.startUtc > Date.now() && (
              <Button variant="ghost" size="sm" onClick={() => cancel(b.id)} disabled={inFlightId === b.id}>
                {inFlightId === b.id ? "Cancelling…" : "Cancel"}
              </Button>
            )}
          </div>
        </div>
      ))}
      <Dialog open={!!completeOpenId} onOpenChange={(open) => { if (!open) setCompleteOpenId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark session as completed</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Optional: add a short note to help track progress. This is only visible to you for now.</p>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 500))} placeholder="Optional notes (max 500 chars)" rows={4} maxLength={500} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteOpenId(null)}>Cancel</Button>
            <Button
              disabled={!!inFlightId && inFlightId === completeOpenId}
              onClick={async () => {
                if (!completeOpenId) return;
                const ok = await submitComplete(completeOpenId, notes?.trim() || undefined);
                if (ok) setCompleteOpenId(null);
              }}
            >
              Mark completed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
