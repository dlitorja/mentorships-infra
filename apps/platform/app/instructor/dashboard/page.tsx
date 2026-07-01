import Link from "next/link";

import { requireRole, getConvexAuthToken } from "@/lib/auth-helpers";
import { api } from "@/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";
import { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProtectedLayout } from "@/components/navigation/protected-layout";

type StudentSessionRow = {
  userId: string;
  seatId: Id<"seatReservations">;
  sessionPackId: Id<"sessionPacks">;
  studentEmail: string | null;
  studentFirstName: string | null;
  studentLastName: string | null;
  totalSessions: number;
  remainingSessions: number;
  seatExpiresAt: number;
  status: "active" | "grace" | "released";
};

function formatDate(date: Date | string | null | number): string {
  if (!date) return "N/A";
  const d = typeof date === "number" ? new Date(date) : typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDisplayName(row: StudentSessionRow): string {
  const fullName = [row.studentFirstName, row.studentLastName].filter(Boolean).join(" ");
  return fullName || row.studentEmail || row.userId;
}

function getSessionBadgeVariant(remainingSessions: number): "default" | "secondary" | "destructive" | "outline" {
  if (remainingSessions === 0) return "destructive";
  if (remainingSessions <= 1) return "secondary";
  return "default";
}

/** Instructor dashboard focused on active students and remaining session counts. */
export default async function InstructorDashboardPage() {
  const user = await requireRole("instructor");
  const token = await getConvexAuthToken();
  const instructorRecord = await fetchQuery(
    api.instructors.getInstructorByUserId,
    { userId: user.id },
    { token: token ?? undefined }
  );

  if (!instructorRecord) {
    return (
      <ProtectedLayout currentPath="/instructor/dashboard">
        <div className="container mx-auto p-4 md:p-8">
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">
                Instructor profile not found. Please contact support.
              </p>
            </CardContent>
          </Card>
        </div>
      </ProtectedLayout>
    );
  }

  let studentRows: StudentSessionRow[] = [];
  try {
    studentRows = (await fetchQuery(
      api.seatReservations.getInstructorStudentsWithRemainingSessions,
      { instructorId: instructorRecord._id as Id<"instructors"> },
      { token: token ?? undefined }
    )) as StudentSessionRow[];
  } catch (e) {
    console.error("Failed to load instructor student session counts", e);
  }

  return (
    <ProtectedLayout currentPath="/instructor/dashboard">
      <div className="container mx-auto p-4 md:p-8 space-y-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Instructor Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back, {instructorRecord.name || "Instructor"}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Students & Remaining Sessions</CardTitle>
            <CardDescription>
              Active student session packs, sorted by lowest remaining sessions first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {studentRows.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
                No active students yet.
              </div>
            ) : (
              <div className="divide-y rounded-lg border">
                {studentRows.map((row) => (
                  <Link
                    key={row.seatId}
                    href={`/instructor/students/${row.userId}`}
                    className="flex flex-col gap-3 p-4 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{getDisplayName(row)}</p>
                      {row.studentEmail && getDisplayName(row) !== row.studentEmail && (
                        <p className="truncate text-sm text-muted-foreground">{row.studentEmail}</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        Pack expires {formatDate(row.seatExpiresAt)}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={getSessionBadgeVariant(row.remainingSessions)}>
                        {row.remainingSessions} / {row.totalSessions} sessions left
                      </Badge>
                      {row.status !== "active" && <Badge variant="outline">{row.status}</Badge>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ProtectedLayout>
  );
}
