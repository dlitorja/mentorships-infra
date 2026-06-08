"use client";

import { Suspense } from "react";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAllStudentSessions } from "@/lib/queries/convex/use-sessions";
import { Loader2 } from "lucide-react";

function formatDateTime(date: number): string {
  return new Date(date).toLocaleString("en-US", {
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

function SessionsContent() {
  const { user, isLoaded } = useUser();
  const userId = user?.id;

  const { data: userSessions, isLoading } = useAllStudentSessions(userId || "");

  if (!isLoaded) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Sign In Required</CardTitle>
            <CardDescription>
              Please sign in to view your sessions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/sign-in">Sign In</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">My Sessions</h2>
        <p className="text-muted-foreground">
          View and manage your mentorship sessions
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : !userSessions || userSessions.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              You don't have any sessions yet. Book your first session through the calendar!
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {userSessions.map((session) => (
            <Card key={session.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-xl">{session.instructorEmail || "Unknown Instructor"}</CardTitle>
                    <CardDescription>
                      {formatDateTime(session.scheduledAt)}
                    </CardDescription>
                  </div>
                  <Badge variant={getStatusBadgeVariant(session.status)}>
                    {session.status}
                  </Badge>
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
                      <p className="text-sm text-muted-foreground">{session.notes}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SessionsPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto p-4 md:p-8 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <SessionsContent />
    </Suspense>
  );
}