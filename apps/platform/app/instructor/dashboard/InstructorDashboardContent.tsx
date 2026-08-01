"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import type { FunctionReturnType } from "convex/server";

const STUDENT_LIST_LIMIT = 100;

type StudentSessionRows = FunctionReturnType<
  typeof api.seatReservations.getInstructorStudentsWithRemainingSessions
>;
type StudentSessionRow = StudentSessionRows[number];

function getDisplayName(row: StudentSessionRow): string {
  const fullName = [row.studentFirstName, row.studentLastName].filter(Boolean).join(" ");
  return fullName || row.studentEmail || row.userId;
}

function getSessionBadgeVariant(
  remainingSessions: number
): "default" | "secondary" | "destructive" | "outline" {
  if (remainingSessions === 0) return "destructive";
  if (remainingSessions <= 1) return "secondary";
  return "default";
}

export function InstructorDashboardContent({
  instructorId,
}: {
  instructorId: Id<"instructors">;
}) {
  const { data: studentRows } = useSuspenseQuery(
    convexQuery(api.seatReservations.getInstructorStudentsWithRemainingSessions, {
      instructorId,
      limit: STUDENT_LIST_LIMIT,
    })
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Students & Remaining Sessions</CardTitle>
        <CardDescription>
          Active student session packs, sorted by lowest remaining sessions first.
          {studentRows.length >= STUDENT_LIST_LIMIT && (
            <span className="ml-1 text-muted-foreground">
              (Showing first {STUDENT_LIST_LIMIT} students)
            </span>
          )}
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
                key={row.seatId ?? row.workspaceId ?? row.userId}
                href={
                  row.workspaceId
                    ? `/workspace/${row.workspaceId}`
                    : `/instructor/students/${row.userId}`
                }
                className="flex flex-col gap-3 p-4 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium">{getDisplayName(row)}</p>
                  {row.studentEmail && getDisplayName(row) !== row.studentEmail && (
                    <p className="truncate text-sm text-muted-foreground">{row.studentEmail}</p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {row.hasSessionPack ? (
                    <Badge variant={getSessionBadgeVariant(row.remainingSessions)}>
                      {row.remainingSessions}{" "}
                      {row.remainingSessions === 1 ? "session" : "sessions"} remaining
                    </Badge>
                  ) : (
                    <Badge variant="outline">No active pack</Badge>
                  )}
                  {row.status === "grace" && <Badge variant="outline">{row.status}</Badge>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
