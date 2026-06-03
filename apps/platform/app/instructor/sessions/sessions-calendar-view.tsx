"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Clock, User } from "lucide-react";
import { SessionActions } from "@/components/instructor/session-actions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Session = {
  id: Id<"sessions">;
  scheduledAt: number;
  status: "scheduled" | "completed" | "canceled" | "no_show";
  notes: string | null;
  recordingUrl: string | null;
  completedAt: number | null;
  canceledAt: number | null;
  studentEmail: string | null;
  remainingSessions: number | null;
  sessionPackId: Id<"sessionPacks">;
};

type SessionsCalendarViewProps = {
  sessions: Session[];
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function buildCalendarDays(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatDate(date: Date | number): string {
  const d = typeof date === "number" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function getStatusColor(status: string): string {
  switch (status) {
    case "scheduled": return "bg-blue-100 text-blue-700 border-blue-200";
    case "completed": return "bg-green-100 text-green-700 border-green-200";
    case "canceled": return "bg-red-100 text-red-700 border-red-200";
    case "no_show": return "bg-gray-100 text-gray-700 border-gray-200";
    default: return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

function sessionDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function SessionsCalendarView({ sessions }: SessionsCalendarViewProps) {
  const router = useRouter();
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [viewYear, setViewYear] = useState(() => today.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => today.getMonth());
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const days = useMemo(() => buildCalendarDays(viewYear, viewMonth), [viewYear, viewMonth]);

  const sessionsByDay = useMemo(() => {
    const result: Record<string, Session[]> = {};
    for (const session of sessions) {
      const key = sessionDateKey(session.scheduledAt);
      if (!result[key]) result[key] = [];
      result[key].push(session);
    }
    for (const key in result) {
      result[key].sort((a, b) => a.scheduledAt - b.scheduledAt);
    }
    return result;
  }, [sessions]);

  const monthName = useMemo(
    () => `${MONTH_NAMES[viewMonth]} ${viewYear}`,
    [viewYear, viewMonth]
  );

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }

  function daySessions(day: number): Session[] {
    const key = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return sessionsByDay[key] ?? [];
  }

  function handleSessionClick(session: Session) {
    setSelectedSession(session);
    setIsDialogOpen(true);
  }

  function handleShowMore(day: number) {
    setSelectedDay(day);
    setSelectedSession(daySessions(day)[3]);
    setIsDialogOpen(true);
  }

  function handleRefresh() {
    router.refresh();
    setIsDialogOpen(false);
  }

  const isUpcoming = selectedSession ? selectedSession.status === "scheduled" && selectedSession.scheduledAt > Date.now() : false;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={prevMonth} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="font-medium">{monthName}</span>
        <Button variant="ghost" size="icon" onClick={nextMonth} aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-xs text-muted-foreground py-2 font-medium border-b">
            {d}
          </div>
        ))}
        {days.map((day, idx) => {
          if (day === null) return <div key={`empty-${idx}`} className="min-h-[80px] border-b border-r bg-muted/20" />;
          const dayKey = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const daySessionsList = sessionsByDay[dayKey] ?? [];
          const isPast = new Date(viewYear, viewMonth, day) < today;

          return (
            <div
              key={day}
              className={[
                "min-h-[80px] border-b border-r p-1 text-left",
                isPast ? "bg-muted/10" : "bg-background",
              ].join(" ")}
            >
              <div className={[
                "text-xs font-medium mb-1",
                isPast ? "text-muted-foreground" : "text-foreground",
              ].join(" ")}>
                {day}
              </div>
              <div className="space-y-0.5">
                {daySessionsList.slice(0, 3).map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => handleSessionClick(session)}
                    className={[
                      "w-full text-left text-[10px] px-1 py-0.5 rounded border truncate",
                      session.status === "scheduled" && session.scheduledAt > Date.now()
                        ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                        : session.status === "completed"
                        ? "bg-green-50 text-green-700 border-green-200"
                        : "bg-gray-50 text-gray-600 border-gray-200",
                    ].join(" ")}
                  >
                    {formatTime(session.scheduledAt)} {session.studentEmail?.split("@")[0] ?? "?"}
                  </button>
                ))}
                {daySessionsList.length > 3 && (
                  <button
                    type="button"
                    onClick={() => handleShowMore(day)}
                    className="w-full text-[10px] text-muted-foreground text-center hover:text-foreground"
                  >
                    +{daySessionsList.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-xs text-muted-foreground py-2 font-medium border-b">
            {d}
          </div>
        ))}
        {days.map((day, idx) => {
          if (day === null) return <div key={`empty-${idx}`} className="min-h-[80px] border-b border-r bg-muted/20" />;
          const dayKey = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const daySessionsList = sessionsByDay[dayKey] ?? [];
          const isPast = new Date(viewYear, viewMonth, day) < today;
          const hasScheduled = daySessionsList.some(s => s.status === "scheduled");

          return (
            <div
              key={day}
              className={[
                "min-h-[80px] border-b border-r p-1 text-left",
                isPast ? "bg-muted/10" : "bg-background",
              ].join(" ")}
            >
              <div className={[
                "text-xs font-medium mb-1",
                isPast ? "text-muted-foreground" : "text-foreground",
              ].join(" ")}>
                {day}
              </div>
              <div className="space-y-0.5">
                {daySessionsList.slice(0, 3).map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => handleSessionClick(session)}
                    className={[
                      "w-full text-left text-[10px] px-1 py-0.5 rounded border truncate",
                      session.status === "scheduled" && session.scheduledAt > Date.now()
                        ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                        : session.status === "completed"
                        ? "bg-green-50 text-green-700 border-green-200"
                        : "bg-gray-50 text-gray-600 border-gray-200",
                    ].join(" ")}
                  >
                    {formatTime(session.scheduledAt)} {session.studentEmail?.split("@")[0] ?? "?"}
                  </button>
                ))}
                {daySessionsList.length > 3 && (
                  <div className="text-[10px] text-muted-foreground text-center">
                    +{daySessionsList.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-blue-100 border border-blue-200" />
          <span>Scheduled</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-100 border border-green-200" />
          <span>Completed</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-gray-100 border border-gray-200" />
          <span>Other</span>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Session Details</DialogTitle>
          </DialogHeader>
          {selectedSession && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{selectedSession.studentEmail ?? "Unknown student"}</span>
                </div>
                <Badge className={getStatusColor(selectedSession.status)}>
                  {selectedSession.status}
                </Badge>
              </div>

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>{formatDate(selectedSession.scheduledAt)}</span>
              </div>

              {selectedSession.remainingSessions !== null && (
                <p className="text-sm text-muted-foreground">
                  Remaining sessions in pack: {selectedSession.remainingSessions}
                </p>
              )}

              {selectedSession.notes && (
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-sm font-medium mb-1">Notes:</p>
                  <p className="text-sm text-muted-foreground">{selectedSession.notes}</p>
                </div>
              )}

              <div className="flex justify-end">
                <SessionActions
                  session={{
                    id: selectedSession.id,
                    scheduledAt: selectedSession.scheduledAt,
                    studentEmail: selectedSession.studentEmail,
                    notes: selectedSession.notes,
                    status: selectedSession.status,
                  }}
                  onSessionUpdated={handleRefresh}
                  allowedActions={isUpcoming ? ["reschedule", "cancel", "notes"] : ["notes"]}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}