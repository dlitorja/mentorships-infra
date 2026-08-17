"use client";

import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, User, BookOpen, CheckCircle2, Loader2 } from "lucide-react";
import { useUserActiveSessionPacks, useUserTotalRemainingSessions } from "@/lib/queries/convex/use-session-packs";
import { useUpcomingSessions, useRecentSessions } from "@/lib/queries/convex/use-sessions";
import { useInstructorById, useInstructorByUserId } from "@/lib/queries/convex/use-instructors";
import { Id } from "@/convex/_generated/dataModel";

function formatDate(date: number): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(date: number): string {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface SessionPackData {
  _id: Id<"sessionPacks">;
  instructorId: Id<"instructors">;
  totalSessions: number;
  remainingSessions: number;
  expiresAt?: number;
  purchasedAt: number;
  mentorshipType?: string;
  workspaceId: string | null;
}

interface SessionData {
  _id: Id<"sessions">;
  instructorId: Id<"instructors">;
  sessionPackId?: Id<"sessionPacks">;
  scheduledAt: number;
  status: string;
  workspaceId: string | null;
}

interface RecentSessionData {
  id: Id<"sessions">;
  instructorId: Id<"instructors">;
  scheduledAt: number;
  completedAt?: number;
  canceledAt?: number;
  status: "scheduled" | "completed" | "canceled" | "no_show";
  instructorUser: { email: string } | null;
}

function InstructorBadge({ instructorId }: { instructorId: string }) {
  const { data: instructor, isLoading } = useInstructorById(instructorId as Id<"instructors">);
  if (isLoading || !instructor) return null;
  return (
    <div>
      <span className="font-medium">{instructor.bio || instructor.email}</span>
    </div>
  );
}

function SessionPackCard({ pack }: { pack: SessionPackData }) {
  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <InstructorBadge instructorId={pack.instructorId} />
        </div>
        <Badge variant="secondary">
          <BookOpen className="h-3 w-3 mr-1" aria-hidden="true" />
          {pack.remainingSessions} left
        </Badge>
      </div>
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-1">
          <Calendar className="h-4 w-4" />
          <span>
            {pack.expiresAt
              ? `Expires ${formatDate(pack.expiresAt)}`
              : "No expiration"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="h-4 w-4" />
          <span>
            {pack.totalSessions - pack.remainingSessions}/
            {pack.totalSessions} used
          </span>
        </div>
      </div>
      {pack.workspaceId && (
        <div className="pt-2">
          <Link
            href={`/workspace/${pack.workspaceId}`}
            className="text-sm text-primary hover:underline"
          >
            Open workspace →
          </Link>
        </div>
      )}
    </div>
  );
}

function UpcomingSessionCard({ session }: { session: SessionData }) {
  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <InstructorBadge instructorId={session.instructorId} />
          <p className="text-sm text-muted-foreground">
            {formatDateTime(session.scheduledAt)}
          </p>
        </div>
        <Badge variant="outline">
          <Clock className="h-3 w-3 mr-1" aria-hidden="true" />
          Scheduled
        </Badge>
      </div>
      {session.workspaceId && (
        <div className="pt-2">
          <Link
            href={`/workspace/${session.workspaceId}`}
            className="text-sm text-primary hover:underline"
          >
            Open workspace →
          </Link>
        </div>
      )}
    </div>
  );
}

function RecentSessionCard({ session }: { session: RecentSessionData }) {
  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold">
            {session.instructorUser?.email ?? "Unknown instructor"}
          </p>
          <p className="text-sm text-muted-foreground">
            {session.completedAt
              ? `Completed ${formatDateTime(session.completedAt)}`
              : `Status: ${session.status}`}
          </p>
        </div>
        <Badge variant="default">Completed</Badge>
      </div>
    </div>
  );
}

export function DashboardContent() {
  const { user, isLoaded } = useUser();
  const userId = user?.id;

  const { data: instructorRecord } = useInstructorByUserId(userId || "");
  const isInstructorOrAdmin = Boolean(instructorRecord);

  const discordConnected = Boolean(
    user?.externalAccounts?.some((a) => a.provider?.toLowerCase?.().includes("discord"))
  );

  const { data: sessionPacks, isLoading: packsLoading } = useUserActiveSessionPacks(userId || "");
  const { data: totalSessions } = useUserTotalRemainingSessions(userId || "");
  const { data: upcomingSessions, isLoading: sessionsLoading } = useUpcomingSessions(userId || "");
  const { data: recentSessions, isLoading: recentLoading } = useRecentSessions(userId || "");

  const sortedPacks = sessionPacks
    ? [...sessionPacks].sort((a, b) => b.purchasedAt - a.purchasedAt)
    : [];

  const uniqueInstructorCount = new Set(
    sessionPacks?.map((p) => p.instructorId) ?? []
  ).size;

  if (!isLoaded) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back, {user.primaryEmailAddress?.emailAddress}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Remaining Sessions
            </CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalSessions ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              {(totalSessions ?? 0) === 1 ? "session" : "sessions"} available
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Packs</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sortedPacks.length}</div>
            <p className="text-xs text-muted-foreground">
              {sortedPacks.length === 1 ? "pack" : "packs"} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Instructors</CardTitle>
            <User className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uniqueInstructorCount}</div>
            <p className="text-xs text-muted-foreground">
              {uniqueInstructorCount === 1 ? "instructor" : "instructors"} assigned
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Next steps</CardTitle>
          <CardDescription>
            {discordConnected
              ? "Complete onboarding so your instructor can tailor sessions to your goals."
              : "Connect Discord, then complete onboarding so you can access mentorship channels and get the most out of your sessions."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {!discordConnected ? (
            <Link className="text-primary hover:underline" href="/settings">
              Connect Discord in Settings →
            </Link>
          ) : null}
          <Link className="text-primary hover:underline" href="/dashboard/onboarding">
            Complete onboarding →
          </Link>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Active Session Packs</CardTitle>
            <CardDescription>
              Your current mentorship packs and remaining sessions
            </CardDescription>
          </CardHeader>
          <CardContent>
            {packsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : sortedPacks.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="mb-2">No active session packs</p>
                <Link
                  href="/instructors"
                  className="text-primary hover:underline"
                >
                  Browse instructors →
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {sortedPacks.map((pack) => (
                  <SessionPackCard key={pack._id} pack={pack as SessionPackData} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming Sessions</CardTitle>
            <CardDescription>
              Your scheduled mentorship sessions
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sessionsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : !upcomingSessions || upcomingSessions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="mb-2">No upcoming sessions</p>
                <Link
                  href="/instructors"
                  className="text-primary hover:underline"
                >
                  Schedule a session →
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {upcomingSessions.map((session) => (
                  <UpcomingSessionCard key={session._id} session={session as SessionData} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {recentSessions && recentSessions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Sessions</CardTitle>
            <CardDescription>Your completed mentorship sessions</CardDescription>
          </CardHeader>
          <CardContent>
            {recentLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : (
              <div className="space-y-4">
                {recentSessions.slice(0, 3).map((session) => (
                  <RecentSessionCard
                    key={session.id}
                    session={session as RecentSessionData}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Link
              href="/instructors"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Browse Instructors
            </Link>
            {(totalSessions ?? 0) > 0 && (
              <Link
                href="/sessions"
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
              >
                Schedule Session
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
