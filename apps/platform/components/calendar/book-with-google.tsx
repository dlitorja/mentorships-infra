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

export function BookWithGoogle({ instructorId }: { instructorId: string }) {
  const start = React.useMemo(() => new Date().toISOString(), []);
  const end = React.useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString();
  }, []);

  const [studentName, setStudentName] = React.useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["availability", instructorId, start, end, 60],
    queryFn: () => fetchInstructorAvailability(instructorId, start, end, 60),
  });

  async function book(slotIso: string) {
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instructorId,
          start: slotIso,
          end: addHours(slotIso, 1),
          timezone,
          studentEmail: "_", // ignored server-side; session email is used
          studentName: studentName || "Student",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.success) {
        toast.success("Booked. Invite sent; Discord link is in the event.");
      } else if (res.status === 409) {
        toast.error("Slot no longer available. Please pick another.");
      } else if (res.status === 502) {
        toast.error(json?.error || "Calendar provider error. Try again later.");
      } else {
        toast.error(json?.error || "Failed to create booking");
      }
    } catch (e) {
      toast.error("Unexpected error while booking");
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

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading availability…</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No available slots in the next 7 days.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {slots.slice(0, 60).map((iso) => {
              const d = new Date(iso);
              return (
                <Button key={iso} variant="outline" onClick={() => book(iso)}>
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
