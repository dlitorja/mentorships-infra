import { requireDbUser, getUser } from "@/lib/auth";
import { getUserSessionPacksWithMentors } from "@mentorships/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { MenteeOnboardingForm } from "@/components/dashboard/mentee-onboarding-form";

export const dynamic = "force-dynamic";

function hasDiscordConnected(clerkUser: Awaited<ReturnType<typeof getUser>>): boolean {
  if (!clerkUser) return false;
  return clerkUser.externalAccounts.some((a) => a.provider?.toLowerCase?.().includes("discord"));
}

export default async function MenteeOnboardingPage() {
  const dbUser = await requireDbUser();
  const clerkUser = await getUser();
  const discordConnected = hasDiscordConnected(clerkUser);

  const sessionPacksResult = await getUserSessionPacksWithMentors(dbUser.id);
  const packs = sessionPacksResult.items.map((p) => ({
    sessionPackId: p.id,
    instructorLabel: p.mentorUser.email,
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
              Connect Discord in your Dashboard so we can assign your mentee role and unlock mentorship channels.
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
        <MenteeOnboardingForm packs={packs} />
      )}
    </div>
  );
}


