"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import Link from "next/link";
import { Archive, User2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { FunctionReturnType } from "convex/server";

type ArchivedMentorshipRow = FunctionReturnType<
  typeof api.workspaces.getInstructorArchivedMentorships
>[number];

interface ArchivedMentorshipsCardProps {
  instructorId: Id<"instructors">;
}

/**
 * Format an `archivedAt` epoch ms into a stable short date string in the
 * instructor's locale — `Intl.DateTimeFormat` is consistent across server /
 * client (no SSR hydration mismatch) and cheap to construct per render.
 */
function formatArchivedDate(epochMs: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(epochMs));
}

/**
 * Resolve what to render in the first line of an archived row.
 *
 * `headline` falls back through `fullName → email → "Unnamed student"`
 * so the row never collapses to a raw Clerk id. The Clerk id of the
 * student is rendered separately as a muted mono line ONLY when both
 * name and email are missing (see AGENTS.md "Clerk User ID Display
 * Convention") so the dashboard user can still reach support while the
 * headline stays identifiable.
 */
function resolveStudentHeadline(row: ArchivedMentorshipRow): {
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

/**
 * PR archive-gating: instructor-facing card showing the workspaces the
 * instructor has archived since the participant-toggleable archive flag
 * shipped. Sits alongside the existing "Active Mentorships" card on
 * `/instructor/dashboard` and is the dedicated categorical surface the
 * spec calls out — the sidebar / picker keep all workspaces visible as
 * muted rows, but no row is hidden from the active list without a way
 * to recover it here.
 *
 * Reads via `useSuspenseQuery` so the parent `<Suspense>` boundary on
 * the dashboard page handles loading; mirrors the read shape used by
 * `InstructorDashboardContent` to keep the active / archived cards
 * visually and behaviorally parallel (one row, two surfaces).
 *
 * "Open" navigates the participant back to `/workspace/[id]` — the
 * archive `archivesAt` + `archivedBy` rows stay readable there so the
 * Unarchive button is one click away. "Archived on" is shown next to
 * the row label so the user can spot accidentally-recent archives vs.
 * long-lapsed ones that should probably be unarchived if intent was
 * to pause (not to delete).
 */
export function ArchivedMentorshipsCard({
  instructorId,
}: ArchivedMentorshipsCardProps) {
  const { data: rows } = useSuspenseQuery(
    convexQuery(api.workspaces.getInstructorArchivedMentorships, { instructorId })
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Archive className="h-4 w-4 text-muted-foreground" />
          Archived Mentorships
        </CardTitle>
        <CardDescription>
          Workspaces you&apos;ve archived. Use <strong>Open</strong> to jump to the
          workspace and either review history or unarchive to resume booking.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <p>No archived mentorships yet.</p>
            <p className="text-xs mt-1 opacity-80">
              Archive a workspace from its title bar to clear it from the
              active list while preserving its data.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const { headline, headlineIsFallback } =
                resolveStudentHeadline(row);
              return (
              <li
                key={row._id}
                className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/30 px-3 py-2 opacity-80"
              >
                <User2
                  className="h-4 w-4 text-muted-foreground shrink-0"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">
                    {headline}
                    {headlineIsFallback && (
                      <span className="ml-2 align-middle text-xs font-normal text-muted-foreground">
                        (no name yet)
                      </span>
                    )}
                  </div>
                  {headlineIsFallback && row.studentUserId && (
                    <p
                      className="text-xs text-muted-foreground/80 font-mono truncate"
                      title={row.studentUserId}
                    >
                      Clerk id: {row.studentUserId}
                    </p>
                  )}
                  <div className="text-xs text-muted-foreground truncate">
                    {row.workspaceDisplayName} ·{" "}
                    <span title={new Date(row.archivedAt).toISOString()}>
                      archived {formatArchivedDate(row.archivedAt)}
                    </span>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/workspace/${row._id}`}>Open</Link>
                </Button>
              </li>
              );
            })}
            </ul>
        )}
      </CardContent>
    </Card>
  );
}
