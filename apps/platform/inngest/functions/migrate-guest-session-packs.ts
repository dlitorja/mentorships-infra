import { inngest } from "../client";
import { api } from "../../../../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { reportInfo, reportError } from "@/lib/observability";
import { z } from "zod";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

function getConvexHttpKey() {
  const key = process.env.CONVEX_HTTP_KEY;
  if (!key) {
    throw new Error("CONVEX_HTTP_KEY is not set");
  }
  return key;
}

const clerkUsersResponseSchema = z.array(z.object({ id: z.string() }));

async function getClerkUserIdByEmail(email: string): Promise<string | null> {
  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  if (!clerkSecretKey) {
    throw new Error("CLERK_SECRET_KEY is not set");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  let response: Response;
  try {
    response = await fetch(
      `https://api.clerk.com/v1/users?email_address[]=${encodeURIComponent(email)}`,
      {
        headers: {
          Authorization: `Bearer ${clerkSecretKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      }
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "unknown");
    throw new Error(`Clerk API error ${response.status}: ${body}`);
  }

  const rawData = await response.json();
  const parsed = clerkUsersResponseSchema.safeParse(rawData);

  if (!parsed.success) {
    throw new Error(`Clerk response validation failed: ${parsed.error.message}`);
  }

  if (parsed.data.length > 0) {
    return parsed.data[0].id;
  }
  return null;
}

type GuestPackFromApi = {
  _id: string;
  userId: string;
};

export const migrateGuestSessionPacks = inngest.createFunction(
  {
    id: "migrate-guest-session-packs",
    name: "Migrate Guest Session Packs",
    retries: 3,
  },
  { event: "migration/migrate-guest-session-packs" },
  async ({ step }) => {
    const convex = getConvexClient();
    const convexHttpKey = getConvexHttpKey();
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;

    const guestSessionPacks = await step.run("find-guest-session-packs", async () => {
      const res = await fetch(`${convexUrl}/api/internal/guest-session-packs`, {
        headers: {
          Authorization: `Bearer ${convexHttpKey}`,
        },
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch guest session packs: ${res.status}`);
      }

      const data = await res.json();
      return (data.packs as GuestPackFromApi[]).map((pack: GuestPackFromApi) => ({
        id: pack._id,
        userId: pack.userId,
        email: pack.userId.replace("email:", ""),
      }));
    });

    if (guestSessionPacks.length === 0) {
      await step.run("report-no-packs", async () => {
        await reportInfo({
          source: "inngest:migrate-guest-session-packs",
          message: "No guest session packs found",
          level: "info",
          context: {},
        });
      });
      return { migrated: 0, skipped: 0, failed: 0, total: 0 };
    }

    await step.run("report-found-packs", async () => {
      await reportInfo({
        source: "inngest:migrate-guest-session-packs",
        message: `Found ${guestSessionPacks.length} guest session packs to migrate`,
        level: "info",
        context: { count: guestSessionPacks.length },
      });
    });

    let migrated = 0;
    let skipped = 0;
    let failed = 0;

    for (const pack of guestSessionPacks) {
      const packId = pack.id as string;
      const packEmail = pack.email as string;

      try {
        const clerkUserId = await step.run(`lookup-clerk-user-${packId}`, async () => {
          return await getClerkUserIdByEmail(packEmail);
        });

        if (!clerkUserId) {
          const emailDomain = packEmail.split("@")[1] ?? "unknown";
          await step.run(`report-no-clerk-user-${packId}`, async () => {
            await reportInfo({
              source: "inngest:migrate-guest-session-packs",
              message: "No Clerk user found for email domain",
              level: "warn",
              context: { packId, emailDomain },
            });
          });
          skipped++;
          continue;
        }

        await step.run(`update-session-pack-${packId}`, async () => {
          await convex.mutation(api.sessionPacks.linkSessionPacksByEmail, {
            clerkUserId,
            email: packEmail,
          });
        });

        await step.run(`update-seat-reservation-${packId}`, async () => {
          await convex.mutation(api.seatReservations.linkSeatReservationsByEmail, {
            clerkUserId,
            email: packEmail,
          });
        });

        migrated++;

        await step.run(`report-success-${packId}`, async () => {
          await reportInfo({
            source: "inngest:migrate-guest-session-packs",
            message: `Migrated session pack for user`,
            level: "info",
            context: { packId, clerkUserId },
          });
        });
      } catch (err) {
        await step.run(`report-error-${packId}`, async () => {
          await reportError({
            source: "inngest:migrate-guest-session-packs",
            error: err instanceof Error ? err : new Error(String(err)),
            message: `Failed to migrate session pack`,
            level: "error",
            context: { packId },
          });
        });
        failed++;
      }
    }

    return { migrated, skipped, failed, total: guestSessionPacks.length };
  }
);