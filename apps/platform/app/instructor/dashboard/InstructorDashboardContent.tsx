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

// PR #929 follow-up (Issue 1): instructors were seeing rows whose
// headline collapsed to a raw Clerk id (`user_abc123def`) when
// there was no `users` document for the seat's student. We solved
// that by giving the headline a friendly fallback (`fullName → email
// → "Unnamed student"`) so the row never collapses to a raw id.
//
// PR clerk-id-secondary-display follow-up: the Clerk id is still
// useful for support / data-repair, but it is no longer rendered
// as a pill-shaped admin widget. It now lives as a small, muted
// mono line under the email subline — visible enough for an admin
// to read or copy from, not so prominent that it crowds out the
// student's actual identifying info. See AGENTS.md "Clerk User ID
// Display Convention".

/**
 * Resolve what to render in the first line of a student row.
 *
 * `headline` falls back through `fullName → email → "Unnamed student"`
 * so the rendered row never collapses to a raw Clerk id. The Clerk
 * id is rendered as a subdued mono line below the email subline (see
 * AGENTS.md "Clerk User ID Display Convention") so support still has
 * a copyable identifier without it dominating the row.
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
              // Sibling structure (headline + email INSIDE the `<Link>`,
              // Clerk-Id subline OUTSIDE) avoids a previous Greptile P2:
              // a nested `<ClerkUserIdCell>` copy button used to bubble
              // its click to the anchor and trigger row navigation. The
              // subdued `<p>` we render now is text-only (no buttons), but
              // we keep the separation so future enhancements (e.g., a
              // copy button) can be added back without reintroducing the
              // bubble-to-anchor bug.
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
                    <p
                      className="truncate text-xs text-muted-foreground/80 font-mono"
                      title={row.userId}
                    >
                      Clerk id: {row.userId}
                    </p>
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
