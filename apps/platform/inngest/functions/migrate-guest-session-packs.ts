import { inngest } from "../client";
import { api } from "../../../../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { reportInfo, reportError } from "@/lib/observability";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

async function getClerkUserIdByEmail(email: string): Promise<string | null> {
  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  if (!clerkSecretKey) {
    throw new Error("CLERK_SECRET_KEY is not set");
  }

  const response = await fetch(
    `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`,
    {
      headers: {
        Authorization: `Bearer ${clerkSecretKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    console.error(`Clerk API error: ${response.status}`);
    return null;
  }

  const data = await response.json();
  if (data.data && data.data.length > 0) {
    return data.data[0].id;
  }
  return null;
}

export const migrateGuestSessionPacks = inngest.createFunction(
  {
    id: "migrate-guest-session-packs",
    name: "Migrate Guest Session Packs",
    retries: 3,
  },
  { event: "migration/migrate-guest-session-packs" },
  async ({ event, step }) => {
    const convex = getConvexClient();

    const guestSessionPacks = await step.run("find-guest-session-packs", async () => {
      const allPacks = await convex.query(api.migrationQueries.getAllSessionPacksForMigration, {});

      const guestPacks = allPacks.filter(
        (pack: any) => pack.userId && pack.userId.startsWith("email:")
      );

      return guestPacks.map((pack: any) => ({
        id: pack._id,
        userId: pack.userId,
        email: pack.userId.replace("email:", ""),
      }));
    });

    if (guestSessionPacks.length === 0) {
      await reportInfo({
        source: "inngest:migrate-guest-session-packs",
        message: "No guest session packs found",
        level: "info",
        context: {},
      });
      return { migrated: 0, skipped: 0, failed: 0 };
    }

    await reportInfo({
      source: "inngest:migrate-guest-session-packs",
      message: `Found ${guestSessionPacks.length} guest session packs to migrate`,
      level: "info",
      context: { count: guestSessionPacks.length },
    });

    let migrated = 0;
    let skipped = 0;
    let failed = 0;

    for (const pack of guestSessionPacks) {
      try {
        const clerkUserId = await step.run(`lookup-clerk-user-${pack.id}`, async () => {
          return await getClerkUserIdByEmail(pack.email);
        });

        if (!clerkUserId) {
          await reportInfo({
            source: "inngest:migrate-guest-session-packs",
            message: `No Clerk user found for email: ${pack.email}`,
            level: "warn",
            context: { packId: pack.id, email: pack.email },
          });
          skipped++;
          continue;
        }

        await step.run(`update-session-pack-${pack.id}`, async () => {
          await convex.mutation(api.sessionPacks.linkSessionPacksByEmail, {
            clerkUserId,
            email: pack.email,
          });
        });

        await step.run(`update-seat-reservation-${pack.id}`, async () => {
          await convex.mutation(api.seatReservations.linkSeatReservationsByEmail, {
            clerkUserId,
            email: pack.email,
          });
        });

        migrated++;

        await reportInfo({
          source: "inngest:migrate-guest-session-packs",
          message: `Migrated session pack ${pack.id} for email ${pack.email} to user ${clerkUserId}`,
          level: "info",
          context: { packId: pack.id, email: pack.email, clerkUserId },
        });
      } catch (error) {
        await reportError({
          source: "inngest:migrate-guest-session-packs",
          error: error instanceof Error ? error : new Error(String(error)),
          message: `Failed to migrate session pack ${pack.id}`,
          level: "error",
          context: { packId: pack.id, email: pack.email },
        });
        failed++;
      }
    }

    return { migrated, skipped, failed, total: guestSessionPacks.length };
  }
);