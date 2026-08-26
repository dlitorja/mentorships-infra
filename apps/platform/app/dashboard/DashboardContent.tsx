"use client";

import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, User } from "lucide-react";
import { useActiveSessionPacksByUser } from "@/lib/queries/convex/use-session-packs";
import { useInstructor, useInstructorByUserId } from "@/lib/queries/convex/use-instructors";
import { useEffect, useRef } from "react";
import { syncDiscordRole } from "@/lib/queries/api-client";
import { Id } from "@/convex/_generated/dataModel";

interface SessionPackData {
  _id: Id<"sessionPacks">;
  instructorId: string;
  totalSessions: number;
  remainingSessions: number;
  purchasedAt: number;
}

interface InstructorSummary {
  instructorId: string;
  totalSessions: number;
  remainingSessions: number;
}

function InstructorName({ instructorId }: { instructorId: string }) {
  const { data: instructor, isLoading } = useInstructor(instructorId);
  if (isLoading) {
    return <span className="text-muted-foreground">Loading...</span>;
  }
  if (!instructor) {
    return <span className="text-muted-foreground">Unknown instructor</span>;
  }
  return <span className="font-medium">{instructor.name}</span>;
}

function InstructorList({ sessionPacks }: { sessionPacks: SessionPackData[] }) {
  if (sessionPacks.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <User className="h-12 w-12 mx-auto mb-4 opacity-50" aria-hidden="true" />
        <p className="mb-2">You don&apos;t have any instructors yet.</p>
        <Link href="/instructors" className="text-primary hover:underline">
          Browse instructors
        </Link>
      </div>
    );
  }

  const instructors = sessionPacks.reduce((acc, pack) => {
    const existing = acc.get(pack.instructorId);
    if (existing) {
      existing.totalSessions += pack.totalSessions;
      existing.remainingSessions += pack.remainingSessions;
    } else {
      acc.set(pack.instructorId, {
        instructorId: pack.instructorId,
        totalSessions: pack.totalSessions,
        remainingSessions: pack.remainingSessions,
      });
    }
    return acc;
  }, new Map<string, InstructorSummary>());

  return (
    <div className="space-y-4">
      {Array.from(instructors.values()).map((instructor) => (
        <div
          key={instructor.instructorId}
          className="border rounded-lg p-4 flex items-center justify-between"
        >
          <InstructorName instructorId={instructor.instructorId} />
          {Number.isFinite(instructor.totalSessions) && (
            <Badge variant="secondary">
              {instructor.remainingSessions}{" "}
              {instructor.remainingSessions === 1 ? "session" : "sessions"}{" "}
              remaining
            </Badge>
          )}
        </div>
      ))}
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

  const { data: sessionPacks, isLoading } = useActiveSessionPacksByUser(userId || "");

  const discordSyncRef = useRef(false);

  useEffect(() => {
    if (!isLoaded || !userId) return;
    if (isInstructorOrAdmin) return;
    if (!discordConnected) return;
    if (discordSyncRef.current) return;
    discordSyncRef.current = true;
    syncDiscordRole().catch(() => {
      // Silently ignore Discord sync failures; this is a background repair mechanism.
    });
  }, [isLoaded, userId, isInstructorOrAdmin, discordConnected]);

  if (!isLoaded || !user) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      <Card>
        <CardHeader>
          <CardTitle>Your Instructors</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
            </div>
          ) : (
            <InstructorList sessionPacks={(sessionPacks ?? []) as SessionPackData[]} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
