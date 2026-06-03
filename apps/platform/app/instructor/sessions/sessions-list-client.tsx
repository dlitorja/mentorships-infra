"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SessionActions } from "@/components/instructor/session-actions";
import { SessionsCalendarView } from "./sessions-calendar-view";
import { Search, Calendar, List } from "lucide-react";

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

type SessionsListClientProps = {
  sessions: Session[];
};

function formatDateTime(date: Date | string | number): string {
  const d = new Date(date);
  return d.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getStatusBadgeVariant(status: string) {
  switch (status) {
    case "completed":
      return "default";
    case "scheduled":
      return "secondary";
    case "canceled":
      return "destructive";
    case "no_show":
      return "outline";
    default:
      return "outline";
  }
}

function SessionCard({ session }: { session: Session }) {
  const router = useRouter();

  function handleRefresh() {
    router.refresh();
  }

  const isUpcoming = session.status === "scheduled" && session.scheduledAt > Date.now();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-xl">
              {session.studentEmail ?? "Unknown student"}
            </CardTitle>
            <CardDescription>
              {formatDateTime(session.scheduledAt)}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={getStatusBadgeVariant(session.status)}>
              {session.status}
            </Badge>
            <SessionActions
              session={{
                id: session.id,
                scheduledAt: session.scheduledAt,
                studentEmail: session.studentEmail,
                notes: session.notes,
                status: session.status,
              }}
              onSessionUpdated={handleRefresh}
              allowedActions={isUpcoming ? ["reschedule", "cancel", "notes"] : ["notes"]}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {session.remainingSessions !== null && (
            <p className="text-sm text-muted-foreground">
              Remaining sessions in pack: {session.remainingSessions}
            </p>
          )}
          {session.completedAt && (
            <p className="text-sm text-muted-foreground">
              Completed: {formatDateTime(session.completedAt)}
            </p>
          )}
          {session.canceledAt && (
            <p className="text-sm text-muted-foreground">
              Canceled: {formatDateTime(session.canceledAt)}
            </p>
          )}
          {session.recordingUrl && (
            <a
              href={session.recordingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline"
            >
              View Recording
            </a>
          )}
          {session.notes && (
            <div className="mt-2">
              <p className="text-sm font-medium">Notes:</p>
              <p className="text-sm text-muted-foreground">
                {session.notes}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function SessionsListClient({ sessions }: SessionsListClientProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");

  const filteredSessions = useMemo(() => {
    return sessions.filter((session) => {
      const matchesSearch =
        searchQuery === "" ||
        (session.studentEmail?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);

      const matchesStatus =
        statusFilter === "all" || session.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [sessions, searchQuery, statusFilter]);

  const upcomingSessions = filteredSessions.filter(
    (s) => s.status === "scheduled" && s.scheduledAt > Date.now()
  );
  const pastSessions = filteredSessions.filter(
    (s) => s.status !== "scheduled" || s.scheduledAt <= Date.now()
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by student email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="canceled">Canceled</SelectItem>
            <SelectItem value="no_show">No Show</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex gap-1 border rounded-md p-1">
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("list")}
            title="List view"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "calendar" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("calendar")}
            title="Calendar view"
          >
            <Calendar className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {viewMode === "calendar" ? (
        <Card>
          <CardContent className="pt-6">
            <SessionsCalendarView sessions={filteredSessions} />
          </CardContent>
        </Card>
      ) : (
        <>
          {upcomingSessions.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Upcoming Sessions</h3>
              <div className="grid gap-4">
                {upcomingSessions.map((session) => (
                  <SessionCard key={session.id} session={session} />
                ))}
              </div>
            </div>
          )}

          {pastSessions.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Past Sessions</h3>
              <div className="grid gap-4">
                {pastSessions.map((session) => (
                  <SessionCard key={session.id} session={session} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {filteredSessions.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              {sessions.length === 0
                ? "You don't have any sessions yet."
                : "No sessions match your search criteria."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}