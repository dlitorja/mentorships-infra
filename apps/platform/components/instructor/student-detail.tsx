"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queries/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Calendar, Mail, Clock, FileText } from "lucide-react";
import { BookSessionDialog } from "./book-session-dialog";

type StudentDetails = {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  timeZone: string | null;
  sessionPack: {
    id: string;
    totalSessions: number;
    remainingSessions: number;
    expiresAt: number | null;
    status: string;
  } | null;
  sessions: Array<{
    id: string;
    scheduledAt: number;
    completedAt: number | null;
    canceledAt: number | null;
    status: string;
    notes: string | null;
    cancelReason: string | null;
  }>;
};

type StudentDetailProps = {
  studentId: string;
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

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function StudentDetail({ studentId }: StudentDetailProps) {
  const [bookDialogOpen, setBookDialogOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["student-details", studentId],
    queryFn: () => apiFetch<StudentDetails>(`/api/instructor/students/${studentId}`),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-destructive text-center">
            Failed to load student details: {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </CardContent>
      </Card>
    );
  }

  const { email, firstName, lastName, timeZone, sessionPack, sessions } = data;
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;

  return (
    <div className="space-y-6">
      {/* Student Info Card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl">{email}</CardTitle>
              {fullName && <CardDescription className="text-base mt-1">{fullName}</CardDescription>}
            </div>
            {sessionPack && (
              <Badge 
                variant={
                  sessionPack.status === "active" ? "default" :
                  sessionPack.status === "depleted" ? "secondary" :
                  sessionPack.status === "expired" ? "destructive" : "outline"
                }
              >
                {sessionPack.status}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span>{email}</span>
            </div>
            {timeZone && (
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>{timeZone}</span>
              </div>
            )}
          </div>

          {sessionPack && (
            <div className="mt-6 pt-6 border-t">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <p className="text-sm text-muted-foreground">Total Sessions</p>
                  <p className="text-2xl font-bold">{sessionPack.totalSessions}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Remaining</p>
                  <p className="text-2xl font-bold">{sessionPack.remainingSessions}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Used</p>
                  <p className="text-2xl font-bold">{sessionPack.totalSessions - sessionPack.remainingSessions}</p>
                </div>
              </div>
              {sessionPack.expiresAt && (
                <p className="mt-4 text-sm text-muted-foreground">
                  Pack expires: {formatDate(sessionPack.expiresAt)}
                </p>
              )}
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <Button onClick={() => setBookDialogOpen(true)} disabled={!sessionPack || sessionPack.remainingSessions === 0}>
              <Calendar className="h-4 w-4 mr-2" />
              Book Session
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Session History Card */}
      <Card>
        <CardHeader>
          <CardTitle>Session History</CardTitle>
          <CardDescription>All sessions with this student</CardDescription>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No sessions yet</p>
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => (
                <div key={session.id} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{formatDateTime(session.scheduledAt)}</p>
                        {session.completedAt && (
                          <span className="text-xs text-muted-foreground">
                            (completed {formatDateTime(session.completedAt)})
                          </span>
                        )}
                        {session.canceledAt && session.status === "canceled" && (
                          <span className="text-xs text-muted-foreground">
                            (canceled {formatDateTime(session.canceledAt)})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge
                          variant={
                            session.status === "completed" ? "default" :
                            session.status === "canceled" ? "destructive" :
                            session.status === "no_show" ? "outline" : "secondary"
                          }
                        >
                          {session.status}
                        </Badge>
                        {session.cancelReason && (
                          <span className="text-xs text-muted-foreground">
                            Reason: {session.cancelReason}
                          </span>
                        )}
                      </div>
                      {session.notes && (
                        <div className="flex items-start gap-2 mt-2 text-sm text-muted-foreground">
                          <FileText className="h-4 w-4 mt-0.5 flex-shrink-0" />
                          <span>{session.notes}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {sessionPack && (
        <BookSessionDialog
          studentId={studentId}
          studentEmail={email}
          sessionPackId={sessionPack.id}
          open={bookDialogOpen}
          onOpenChange={setBookDialogOpen}
        />
      )}
    </div>
  );
}