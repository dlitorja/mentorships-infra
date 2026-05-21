"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchInstructorAvailability } from "@/lib/queries/api-client";
import { toast } from "sonner";

function addHours(dateIso: string, hours: number): string {
  const d = new Date(dateIso);
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

type Pack = { id: string; instructorId: string };

export function BookWithGoogle({ instructorId, packs }: { instructorId?: string; packs?: Pack[] }) {
  const [selectedInstructorId, setSelectedInstructorId] = React.useState<string | null>(
    instructorId || packs?.[0]?.instructorId || null
  );
  const start = React.useMemo(() => new Date().toISOString(), []);
  const [windowDays, setWindowDays] = React.useState<7 | 14>(7);
  const end = React.useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + windowDays);
    return d.toISOString();
  }, [windowDays]);

  const [studentName, setStudentName] = React.useState("");
  const [bookingInFlightIso, setBookingInFlightIso] = React.useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["availability", selectedInstructorId, start, end, 60],
    queryFn: () => fetchInstructorAvailability(selectedInstructorId!, start, end, 60),
    enabled: !!selectedInstructorId,
  });

  async function book(slotIso: string) {
    try {
      setBookingInFlightIso(slotIso);
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      // Create the initial booking first, but do NOT suppress notifications yet.
      // We'll suppress only if the series succeeds and send a single summary.
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instructorId: selectedInstructorId!,
          start: slotIso,
          end: addHours(slotIso, 1),
          timezone,
          studentName: studentName || "Student",
          suppressNotifications: true,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.success) {
        toast.success("Booked. Invite sent; Discord link is in the event.");
        // Attempt weekly series for 3 future weeks by default (4-session program)
        let seriesOk = false;
        try {
          const seriesRes = await fetch("/api/bookings/series", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              instructorId: selectedInstructorId!,
              start: slotIso,
              timezone,
              weeks: 3,
              studentName: studentName || "Student",
            }),
          });
          const seriesJson = await seriesRes.json().catch(() => ({}));
          if (seriesRes.ok && seriesJson?.success) {
            seriesOk = true;
            const created = seriesJson.created ?? 0;
            const skipped = seriesJson.skipped ?? 0;
            if (created > 0 || skipped > 0) {
              toast.success(
                `We also reserved ${created} future weekly ${created === 1 ? "session" : "sessions"}${
                  skipped > 0 ? `; ${skipped} week${skipped === 1 ? "" : "s"} skipped due to conflicts` : ""
                }.`
              );
            }
          } else if (seriesRes.status !== 404) {
            toast.error(seriesJson?.error || "Failed to create weekly reservations");
          }
        } catch {
          // ignore network errors here; we'll fallback notify below
        }
        if (!seriesOk) {
          // Fallback: ensure at least one confirmation email goes out
          const bookingId = json?.booking?._id || json?.booking?.id;
          if (bookingId) {
            try {
              await fetch("/api/bookings/notify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bookingId }),
              });
            } catch {}
          }
        }
        // Refetch availability to reflect booking
        void refetch();
      } else if (res.status === 409) {
        toast.error("Slot no longer available. Please pick another.");
      } else if (res.status === 502) {
        toast.error(json?.error || "Calendar provider error. Try again later.");
      } else {
        toast.error(json?.error || "Failed to create booking");
      }
    } catch (e) {
      toast.error("Unexpected error while booking");
    } finally {
      setBookingInFlightIso(null);
    }
  }

  const slots: string[] = data?.availableSlots ?? [];
  const info = data?.truncated ? "Showing first 500 slots" : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Book With Google</CardTitle>
        <CardDescription>
          Checks live Google availability and creates a calendar event with your invite.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Window controls and consistency explanation */}
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-sm font-medium">Time window</label>
            <div className="mt-1 inline-flex rounded-md border overflow-hidden">
              <button
                type="button"
                className={`px-3 py-1.5 text-sm ${windowDays === 7 ? "bg-primary text-primary-foreground" : "bg-background"}`}
                onClick={() => setWindowDays(7)}
              >
                7 days
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 text-sm border-l ${windowDays === 14 ? "bg-primary text-primary-foreground" : "bg-background"}`}
                onClick={() => setWindowDays(14)}
              >
                14 days
              </button>
            </div>
          </div>

          <div>
            <div className="text-sm font-medium">Consistency</div>
            <p className="text-xs text-muted-foreground mt-1">
              The system will try to reserve this same day and time to keep consistency and momentum. If a specific week isn’t available, we’ll skip it and you can pick another time later. We suggest contacting your instructor in your workspace to reschedule individual sessions.
            </p>
          </div>
        </div>

        {packs && packs.length > 0 && (
          <div>
            <label className="text-sm font-medium">Instructor</label>
            <select
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={selectedInstructorId || ""}
              onChange={(e) => setSelectedInstructorId(e.target.value || null)}
            >
              {packs.map((p) => (
                <option key={p.id} value={p.instructorId}>{p.instructorId}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="text-sm font-medium">Your name (shown to instructor)</label>
          <input
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={studentName}
            placeholder="Your name"
            onChange={(e) => setStudentName(e.target.value)}
          />
        </div>

        {error && (
          <p className="text-sm text-red-600">
            {(error as Error).message || "Failed to load availability"}
          </p>
        )}
        {info && <p className="text-xs text-muted-foreground">{info}</p>}

        {!selectedInstructorId ? (
          <p className="text-sm text-muted-foreground">Select an instructor to view availability.</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading availability…</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No available slots in the next {windowDays} {windowDays === 1 ? "day" : "days"}.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {slots.slice(0, 60).map((iso) => {
              const d = new Date(iso);
              return (
                <Button key={iso} variant="outline" onClick={() => book(iso)} disabled={Boolean(bookingInFlightIso)}>
                  {d.toLocaleString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </Button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
