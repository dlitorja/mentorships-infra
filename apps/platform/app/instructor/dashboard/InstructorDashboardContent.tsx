"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClerkUserIdCell } from "@/components/admin/clerk-user-id-cell";
import Link from "next/link";
import type { FunctionReturnType } from "convex/server";

const STUDENT_LIST_LIMIT = 100;

type StudentSessionRows = FunctionReturnType<
  typeof api.seatReservations.getInstructorStudentsWithRemainingSessions
>;
type StudentSessionRow = StudentSessionRows[number];

// PR #929 follow-up (Issue 1): instructors were seeing rows whose
// headline collapsed to a raw Clerk id (`user_abc123def`) when
// there was no `users` document for the seat's student. That
// happens for any Clerk account whose creator omitted the role /
// name round-trip sync — Stripe checkout writes `users` rows,
// but other entry points (e.g., the public invite form) do not.
// We split the resolver into a named headline + always-on Clerk
// id so the row is usable even when name + email are both null,
// and so a copyable identifier is always one click away.

/**
 * Resolve what to render in the first line of a student row.
 *
 * `headline` falls back through `fullName → email → "Unnamed student"`
 * so the rendered row never collapses to a raw Clerk id. We deliberately
 * keep the Clerk id as a separate, always-rendered second line via
 * `<ClerkUserIdCell>` rather than splicing it into the headline — a copyable
 * id is what admins actually need when the student never finished onboarding.
 */
function getStudentHeadline(row: StudentSessionRow): {
  headline: string;
  headlineIsFallback: boolean;
} {
  const fullName = [row.studentFirstName, row.studentLastName]
    .filter(Boolean)
    .join(" ");
  if (fullName) return { headline: fullName, headlineIsFallback: false };
  if (row.studentEmail) {
    return { headline: row.studentEmail, headlineIsFallback: false };
  }
  return { headline: "Unnamed student", headlineIsFallback: true };
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
        <CardTitle>Active Mentorships</CardTitle>
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
            {studentRows.map((row) => {
              const { headline, headlineIsFallback } = getStudentHeadline(row);
              // Only render the email as a sub-line when it differs from
              // the headline. Email-as-headline is the common case for
              // brand-new students; rendering it twice would be noisy.
              const showEmailSubline =
                headlineIsFallback
                  ? !!row.studentEmail
                  : !!row.studentEmail && headline !== row.studentEmail;
              const rowHref = row.workspaceId
                ? `/workspace/${row.workspaceId}`
                : `/instructor/students/${row.userId}`;
              // Greptile P2: nesting the Clerk id cell inside the row's
              // `<Link>` caused the copy button's click to also navigate to
              // the student page (the cell's button doesn't call
              // preventDefault, and the click bubbles to the anchor). Scope
              // the link to just the headline + email cluster; the Clerk id
              // block stays as a sibling so its copy button keeps working
              // without triggering the row navigation.
              return (
                <div
                  key={row.seatId ?? row.workspaceId ?? row.userId}
                  className="flex flex-col gap-3 p-4 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <Link
                      href={rowHref}
                      className="block min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <p className="font-medium">
                        {headline}
                        {headlineIsFallback && (
                          <span className="ml-2 align-middle text-xs font-normal text-muted-foreground">
                            (no name yet)
                          </span>
                        )}
                      </p>
                      {showEmailSubline && (
                        <p className="truncate text-sm text-muted-foreground">
                          {row.studentEmail}
                        </p>
                      )}
                    </Link>
                    <ClerkUserIdCell
                      id={row.userId}
                      label="Clerk id"
                      showDashboardLink={false}
                      orientation="column"
                    />
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
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
