import { requireRole } from "@/lib/auth";
import { UserButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import {
  getInstructorByUserId,
  getInstructorStudentsWithSessionInfo,
  getInstructorStudentsWithLowSessions,
} from "@mentorships/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, Users, BookOpen, AlertTriangle, User } from "lucide-react";
import Link from "next/link";

function formatDate(date: Date | string | null): string {
  if (!date) return "N/A";
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

function getRenewalEncouragement(studentEmail: string, sessionsRemaining: number): string {
  if (sessionsRemaining === 1) {
    return `Consider reaching out to ${studentEmail} to encourage them to renew their instruction. Not renewing means their slot may become available to other prospective students.`;
  }
  return "";
}

export const dynamic = "force-dynamic";

export default async function InstructorDashboardPage() {
  try {
    const user = await requireRole("instructor");
    const instructor = await getInstructorByUserId(user.id);

    if (!instructor) {
      return (
        <div className="container mx-auto p-4 md:p-8">
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">
                Instructor profile not found. Please contact support.
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }

    const [studentsWithSessions, studentsWithLowSessions] = await Promise.all([
      getInstructorStudentsWithSessionInfo(instructor.id),
      getInstructorStudentsWithLowSessions(instructor.id),
    ]);

    const totalStudents = studentsWithSessions.length;
    const lowSessionStudents = studentsWithLowSessions.length;

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

        {studentsWithLowSessions.length > 0 && (
          <Card className="border-amber-200 bg-amber-50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-amber-800">
                <AlertTriangle className="h-5 w-5" />
                Student Renewal Opportunities
              </CardTitle>
              <CardDescription className="text-amber-700">
                These students have only 1 session remaining. Reach out to encourage renewals!
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {studentsWithLowSessions.map((student) => (
                <div
                  key={student.sessionPackId}
                  className="bg-white rounded-lg p-4 border border-amber-200"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-amber-900">
                        {student.email} has 1 session remaining
                      </p>
                      <p className="text-sm text-amber-700 mt-1">
                        {getRenewalEncouragement(student.email, student.remainingSessions)}
                      </p>
                      {student.lastSessionCompletedAt && (
                        <p className="text-xs text-amber-600 mt-2">
                          Last session: {formatDateTime(student.lastSessionCompletedAt)}
                        </p>
                      )}
                      <p className="text-xs text-amber-600">
                        Pack expires: {formatDate(student.expiresAt)}
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
                Active Students
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalStudents}</div>
              <p className="text-xs text-muted-foreground">
                {totalStudents === 1 ? "student" : "students"} active
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
              <div className="text-2xl font-bold">{lowSessionStudents}</div>
              <p className="text-xs text-muted-foreground">
                {lowSessionStudents === 1 ? "student" : "students"} with 1 session
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
                {studentsWithSessions.reduce((sum, m) => sum + m.completedSessionCount, 0)}
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
                {studentsWithSessions.reduce((sum, m) => sum + m.remainingSessions, 0)}
              </div>
              <p className="text-xs text-muted-foreground">
                across all students
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>My Students</CardTitle>
            <CardDescription>
              All active students with session counts and last session dates
            </CardDescription>
          </CardHeader>
          <CardContent>
            {studentsWithSessions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="mb-2">No active students</p>
                <p className="text-sm">When students purchase session packs with you, they will appear here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {studentsWithSessions.map((student) => (
                  <div
                    key={student.sessionPackId}
                    className={`border rounded-lg p-4 space-y-2 ${
                      student.remainingSessions === 1
                        ? "border-amber-200 bg-amber-50/50"
                        : ""
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold">{student.email}</p>
                        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            <span>Expires {formatDate(student.expiresAt)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <BookOpen className="h-4 w-4" />
                            <span>
                              {student.remainingSessions}/{student.totalSessions} sessions
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            <span>
                              {student.completedSessionCount} completed
                            </span>
                          </div>
                        </div>
                        {student.lastSessionCompletedAt && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Last session: {formatDateTime(student.lastSessionCompletedAt)}
                          </p>
                        )}
                        {student.remainingSessions === 1 && (
                          <p className="text-xs text-amber-700 mt-2 font-medium">
                            💡 Consider reaching out to encourage renewal!
                          </p>
                        )}
                      </div>
                      <Badge
                        variant={
                          student.remainingSessions === 1
                            ? "warning"
                            : "secondary"
                        }
                        className={
                          student.remainingSessions === 1
                            ? "bg-amber-100 text-amber-800"
                            : ""
                        }
                      >
                        {student.remainingSessions} left
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
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      redirect("/sign-in");
    }
    console.error("Instructor dashboard error:", error);
    throw error;
  }
}
