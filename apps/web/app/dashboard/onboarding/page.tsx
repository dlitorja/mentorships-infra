export const dynamic = "force-dynamic";

import { requireDbUser, getUser } from "@/lib/auth";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { StudentOnboardingForm } from "@/components/dashboard/student-onboarding-form";

function hasDiscordConnected(clerkUser: Awaited<ReturnType<typeof getUser>>): boolean {
  if (!clerkUser) return false;
  return clerkUser.externalAccounts.some((a) => a.provider?.toLowerCase?.().includes("discord"));
}

export default async function StudentOnboardingPage() {
  const dbUser = await requireDbUser();
  const clerkUser = await getUser();
  const discordConnected = hasDiscordConnected(clerkUser);

  const convex = getConvexClient();
  const sessionPacksResult = await convex.query(api.sessionPacks.getUserSessionPacksWithInstructors, {
    userId: dbUser.id,
    limit: 100,
    offset: 0,
  });
  const packs = sessionPacksResult.items
    .filter((p: any) => p.instructorUser?.email)
    .map((p: any) => ({
      sessionPackId: p.id,
      instructorLabel: p.instructorUser!.email,
    }));

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6 max-w-3xl">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">Onboarding</h1>
        <p className="text-muted-foreground">
          Help your instructor understand your goals and current work.
        </p>
      </div>

      {!discordConnected ? (
        <Card>
          <CardHeader>
            <CardTitle>Connect Discord</CardTitle>
            <CardDescription>
              Connect Discord in your Dashboard so we can assign your student role and unlock mentorship channels.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link className="text-primary hover:underline" href="/settings">
              Go to Settings →
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {packs.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No active mentorship packs</CardTitle>
            <CardDescription>You need an active pack to submit onboarding.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link className="text-primary hover:underline" href="/instructors">
              Browse instructors →
            </Link>
          </CardContent>
        </Card>
      ) : (
        <StudentOnboardingForm packs={packs} />
      )}
    </div>
  );
}

