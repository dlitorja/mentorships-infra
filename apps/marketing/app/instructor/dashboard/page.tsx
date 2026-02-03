import { requireRole, getUser } from "@/lib/auth";
import { UserButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import {
  getMentorByUserId,
  getMentorMenteesWithSessionInfo,
  getMentorMenteesWithLowSessions,
} from "@mentorships/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, Users, BookOpen, AlertTriangle, User } from "lucide-react";
import Link from "next/link";

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getRenewalEncouragement(menteeEmail: string, sessionsRemaining: number): string {
  if (sessionsRemaining === 1) {
    return `Consider reaching out to ${menteeEmail} to encourage them to renew their mentorship. Not renewing means their slot may become available to other prospective mentees.`;
  }
  return "";
}

export const dynamic = "force-dynamic";

export default async function InstructorDashboardPage() {
  try {
    const user = await requireRole("mentor");
    const clerkUser = await getUser();
    const mentor = await getMentorByUserId(user.id);

    if (!mentor) {
      return (
        <div className="container mx-auto p-4 md:p-8">
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">
                Mentor profile not found. Please contact support.
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }

    const [menteesWithSessions, menteesWithLowSessions] = await Promise.all([
      getMentorMenteesWithSessionInfo(mentor.id),
      getMentorMenteesWithLowSessions(mentor.id),
    ]);

    const totalMentees = menteesWithSessions.length;
    const lowSessionMentees = menteesWithLowSessions.length;

    return (
      <div className="container mx-auto p-4 md:p-8 space-y-6">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Instructor Dashboard</h1>
            <p className="text-muted-foreground mt-1">
              Welcome back, {user.email}
            </p>
          </div>
          <UserButton afterSignOutUrl="/" />
        </div>

        {menteesWithLowSessions.length > 0 && (
          <Card className="border-amber-200 bg-amber-50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-amber-800">
                <AlertTriangle className="h-5 w-5" />
                Mentee Renewal Opportunities
              </CardTitle>
              <CardDescription className="text-amber-700">
                These mentees have only 1 session remaining. Reach out to encourage renewals!
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {menteesWithLowSessions.map((mentee) => (
                <div
                  key={mentee.sessionPackId}
                  className="bg-white rounded-lg p-4 border border-amber-200"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-amber-900">
                        {mentee.email} has 1 session remaining
                      </p>
                      <p className="text-sm text-amber-700 mt-1">
                        {getRenewalEncouragement(mentee.email, mentee.remainingSessions)}
                      </p>
                      {mentee.lastSessionCompletedAt && (
                        <p className="text-xs text-amber-600 mt-2">
                          Last session: {formatDateTime(mentee.lastSessionCompletedAt)}
                        </p>
                      )}
                      <p className="text-xs text-amber-600">
                        Pack expires: {formatDate(mentee.expiresAt)}
                      </p>
                    </div>
                    <Badge variant="warning" className="bg-amber-200 text-amber-800">
                      1 Session Left
                    </Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Active Mentees
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalMentees}</div>
              <p className="text-xs text-muted-foreground">
                {totalMentees === 1 ? "mentee" : "mentees"} active
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Low Session Alerts
              </CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{lowSessionMentees}</div>
              <p className="text-xs text-muted-foreground">
                {lowSessionMentees === 1 ? "mentee" : "mentees"} with 1 session
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Total Sessions Used
              </CardTitle>
              <BookOpen className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {menteesWithSessions.reduce((sum, m) => sum + m.completedSessionCount, 0)}
              </div>
              <p className="text-xs text-muted-foreground">
                sessions completed
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Sessions Remaining
              </CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {menteesWithSessions.reduce((sum, m) => sum + m.remainingSessions, 0)}
              </div>
              <p className="text-xs text-muted-foreground">
                across all mentees
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>My Mentees</CardTitle>
            <CardDescription>
              All active mentees with session counts and last session dates
            </CardDescription>
          </CardHeader>
          <CardContent>
            {menteesWithSessions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="mb-2">No active mentees</p>
                <p className="text-sm">When students purchase session packs with you, they will appear here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {menteesWithSessions.map((mentee) => (
                  <div
                    key={mentee.sessionPackId}
                    className={`border rounded-lg p-4 space-y-2 ${
                      mentee.remainingSessions === 1
                        ? "border-amber-200 bg-amber-50/50"
                        : ""
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold">{mentee.email}</p>
                        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            <span>Expires {formatDate(mentee.expiresAt)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <BookOpen className="h-4 w-4" />
                            <span>
                              {mentee.remainingSessions}/{mentee.totalSessions} sessions
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            <span>
                              {mentee.completedSessionCount} completed
                            </span>
                          </div>
                        </div>
                        {mentee.lastSessionCompletedAt && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Last session: {formatDateTime(mentee.lastSessionCompletedAt)}
                          </p>
                        )}
                        {mentee.remainingSessions === 1 && (
                          <p className="text-xs text-amber-700 mt-2 font-medium">
                            💡 Consider reaching out to encourage renewal!
                          </p>
                        )}
                      </div>
                      <Badge
                        variant={
                          mentee.remainingSessions === 1
                            ? "warning"
                            : "secondary"
                        }
                        className={
                          mentee.remainingSessions === 1
                            ? "bg-amber-100 text-amber-800"
                            : ""
                        }
                      >
                        {mentee.remainingSessions} left
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <Link
                href="/instructor/sessions"
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                View All Sessions
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Unauthorized") ||
        error.message.includes("insufficient_permissions"))
    ) {
      redirect("/sign-in");
    }
    console.error("Instructor dashboard error:", error);
    throw error;
  }
}
