"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Booking = { id: string; startUtc: number; endUtc: number; studentEmail: string; status: string };

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

  async function complete(id: string) {
    if (!confirm("Mark this session as completed?")) return;
    setInFlightId(id);
    try {
      const res = await fetch(`/api/bookings/${id}/complete`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.success) {
        setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status: "completed" } : b)));
        toast.success("Session marked as completed");
      } else {
        toast.error(json?.error || "Failed to mark completed");
      }
    } catch (e) {
      toast.error("Unexpected error while marking completed");
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
            <Badge variant={b.status === "confirmed" ? "secondary" : "outline"}>{b.status}</Badge>
            {b.status === "confirmed" && b.startUtc < Date.now() && (
              <Button variant="ghost" size="sm" onClick={() => complete(b.id)} disabled={inFlightId === b.id}>
                {inFlightId === b.id ? "Updating…" : "Mark completed"}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => cancel(b.id)} disabled={inFlightId === b.id}>
              {inFlightId === b.id ? "Cancelling…" : "Cancel"}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
