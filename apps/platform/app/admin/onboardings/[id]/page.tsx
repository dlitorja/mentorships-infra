"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  AlertTriangle,
  ArrowLeft,
  ListChecks,
  Search,
} from "lucide-react";
import { useAdminOnboarding } from "@/lib/queries/convex/use-admin-onboardings";
import { statusLabel, timelineEventLabel, type OnboardingStatus } from "@/lib/admin-onboarding";
import type { Id } from "@/convex/_generated/dataModel";

const STATUS_VARIANTS: Record<
  OnboardingStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  queued: "outline",
  processing: "default",
  completed: "secondary",
  failed: "destructive",
  cancelled: "outline",
};

function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}

function parseOnboardingId(raw: string | string[] | undefined): Id<"adminOnboardings"> | null {
  if (typeof raw !== "string" || !raw) return null;
  return raw as Id<"adminOnboardings">;
}

export default function AdminOnboardingDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const id = parseOnboardingId(params?.id);

  const { data, isLoading, error } = useAdminOnboarding(id);

  if (!id) {
    return (
      <div className="container mx-auto py-8">
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/onboardings">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to list
            </Link>
          </Button>
        </div>
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertTriangle className="inline h-4 w-4 mr-2" />
          Missing onboarding id in the URL.
        </div>
      </div>
    );
  }

  // Split out the "loaded but record not found" case so the UI does not
  // spin forever on stale detail links (Greptile finding).
  const isLoaded = !isLoading && !error;
  const isMissing = isLoaded && data === null;

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/onboardings">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to list
          </Link>
        </Button>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ListChecks className="h-6 w-6" />
          Onboarding detail
        </h1>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertTriangle className="inline h-4 w-4 mr-2" />
          Failed to load: {String((error as Error).message ?? error)}
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : isMissing ? (
        <div className="rounded-md border bg-muted/30 p-6 text-center">
          <Search className="inline h-5 w-5 mr-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No onboarding found for id <span className="font-mono">{id}</span>. It may have been removed or the link is stale.
          </p>
          <div className="mt-4">
            <Button variant="outline" asChild>
              <Link href="/admin/onboardings">Back to list</Link>
            </Button>
          </div>
        </div>
      ) : data ? (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
              <CardDescription>
                Submitted {formatDateTime(data.createdAt)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Email</span>
                <span className="font-mono">{data.email}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={STATUS_VARIANTS[data.status]}>
                  {statusLabel(data.status)}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Source</span>
                <Badge variant="outline">{data.source}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Flow version</span>
                <span>{data.flowVersion}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Attempts</span>
                <span>{data.attemptCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Submitted by</span>
                <span className="font-mono text-xs">{data.submittedByUserId}</span>
              </div>
              {data.completedAt ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Completed</span>
                  <span>{formatDateTime(data.completedAt)}</span>
                </div>
              ) : null}
              {data.cancelledAt ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Cancelled</span>
                  <span>{formatDateTime(data.cancelledAt)}</span>
                </div>
              ) : null}
              {data.failureReason ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive">
                  <strong>Failure:</strong> {data.failureReason}
                </div>
              ) : null}
              {data.capacityOverrideReason ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                  <strong>Capacity override:</strong> {data.capacityOverrideReason}
                </div>
              ) : null}
              {data.notes ? (
                <div className="rounded-md border bg-muted/30 p-3">
                  <strong>Notes:</strong> {data.notes}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Per-instructor assignments</CardTitle>
              <CardDescription>
                {data.perInstructor.length} instructor
                {data.perInstructor.length === 1 ? "" : "s"} assigned
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {data.perInstructor.map((p, idx) => (
                  <li
                    key={`${p.instructorId}-${idx}`}
                    className="rounded-md border p-3 text-sm space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs">{p.instructorId}</span>
                      <Badge variant={p.isRenewal ? "secondary" : "outline"}>
                        {p.isRenewal ? "Renewal" : "New workspace"}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground">
                      Sessions: {p.sessionsPerInstructor}
                    </div>
                    {p.workspaceId ? (
                      <div className="text-muted-foreground">
                        Workspace: <span className="font-mono text-xs">{p.workspaceId}</span>
                      </div>
                    ) : null}
                    {p.capacityOverride ? (
                      <Badge variant="outline" className="text-amber-700 border-amber-500">
                        Capacity override
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
              <CardDescription>
                {data.timeline.length} event
                {data.timeline.length === 1 ? "" : "s"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2">
                {[...data.timeline].reverse().map((entry, idx) => (
                  <li
                    key={`${entry.at}-${idx}`}
                    className="flex items-start gap-3 border-b pb-2 last:border-b-0"
                  >
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDateTime(entry.at)}
                    </span>
                    <span className="text-sm">
                      {timelineEventLabel(entry.event)}
                      {entry.details ? (
                        <span className="text-muted-foreground"> — {entry.details}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
