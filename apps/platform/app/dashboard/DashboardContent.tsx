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
import { useStudentOnboardingGateForCurrentUser } from "@/lib/queries/convex/use-onboarding-views";
import { OnboardingWelcomeCard } from "@/components/onboarding/onboarding-gate-banner";
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

export function DashboardContent({ isTestWebhookBypass = false }: { isTestWebhookBypass?: boolean } = {}) {
  const { user, isLoaded } = useUser();
  const userId = user?.id;

  const { data: instructorRecord } = useInstructorByUserId(userId || "");
  const isInstructorOrAdmin = Boolean(instructorRecord);

  // Greptile round-15 P2: the previous `isInstructorOrAdmin`
  // check only verified that a `instructors` row existed and
  // missed `admin` and `support` users with a stale unfinished
  // student-shape `adminOnboardings` row. They were seeing
  // student-only prompts on the dashboard. Read the role from
  // Clerk's publicMetadata (mirrors ProtectedLayout's likelyRole
  // mapping) and gate-disable for any non-student role.
  const claimsRoleRaw =
    (user?.publicMetadata as Record<string, unknown> | undefined)?.role;
  const claimsRole =
    typeof claimsRoleRaw === "string" ? claimsRoleRaw.toLowerCase() : undefined;
  const isStudentRole =
    claimsRole === undefined || claimsRole === "student";
  const isStaff =
    isInstructorOrAdmin || claimsRole === "admin" || claimsRole === "support";
  // The dashboard layout already redirects staff to
  // `/instructor/dashboard`; we suppress the gate here so a
  // transient `true` envelope (from a stale DB lookup) doesn't
  // gate them out of their own flow.

  // PR 12 PR E (Follow-up) — Gate envelope. Suppressed for
  // instructor/admin identities: the dashboard layout above already
  // redirects them to `/instructor/dashboard`, and we don't want a
  // transient "true" envelope (from a stale instructor row lookup)
  // to gate them out of their own flow.
  //
  // Greptile round-9 P2: `TEST_WEBHOOK_BYPASS=true` (passed down
  // from the server-rendered `app/dashboard/page.tsx`) also
  // disables the query so the welcome card doesn't pop up mid-E2E
  // when proxy.ts already short-circuited the gate.
  const { data: gate } = useStudentOnboardingGateForCurrentUser({
    enabled:
      !isStaff && isStudentRole && !isTestWebhookBypass && Boolean(userId),
  });

  const discordConnected = Boolean(
    user?.externalAccounts?.some((a) => a.provider?.toLowerCase?.().includes("discord"))
  );

  const { data: sessionPacks, isLoading } = useActiveSessionPacksByUser(userId || "");

  const discordSyncRef = useRef(false);

  useEffect(() => {
    if (!isLoaded || !userId) return;
    if (isInstructorOrAdmin) return;
    if (claimsRole === "admin" || claimsRole === "support") return;
    if (!discordConnected) return;
    if (discordSyncRef.current) return;
    discordSyncRef.current = true;
    syncDiscordRole().catch(() => {
      // Silently ignore Discord sync failures; this is a background repair mechanism.
    });
  }, [isLoaded, userId, isInstructorOrAdmin, claimsRole, discordConnected]);

  if (!isLoaded || !user) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  // PR 12 PR E (Follow-up) — Render the welcome card ABOVE the
  // dashboard panels for a student whose onboarding has not yet
  // been completed. The student lands here because Clerk's
  // AFTER_SIGN_UP_URL is `/dashboard`; we use this as the
  // interstitial to point them at `/onboarding/[id]` instead of
  // wasting their attention on an empty instructor list.
  const safeGate = gate ?? {
    requiresOnboardingCompletion: false,
    onboardingId: null,
    rowStatus: null,
    questionnaireSubmitted: true,
    reason: null,
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      {!isStaff && safeGate.requiresOnboardingCompletion && safeGate.onboardingId && (
        <OnboardingWelcomeCard gate={safeGate} />
      )}

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
