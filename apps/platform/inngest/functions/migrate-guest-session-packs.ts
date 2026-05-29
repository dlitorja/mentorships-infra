import { inngest } from "../client";
import { reportInfo, reportError } from "@/lib/observability";
import { z } from "zod";

function getConvexHttpKey() {
  const key = process.env.CONVEX_HTTP_KEY;
  if (!key) {
    throw new Error("CONVEX_HTTP_KEY is not set");
  }
  return key;
}

const clerkUsersResponseSchema = z.array(z.object({ id: z.string() }));

const guestPackSchema = z.object({
  _id: z.string(),
  userId: z.string(),
});

const convexResponseSchema = z.object({
  packs: z.array(guestPackSchema),
});

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

export const migrateGuestSessionPacks = inngest.createFunction(
  {
    id: "migrate-guest-session-packs",
    name: "Migrate Guest Session Packs",
    retries: 3,
  },
  { event: "migration/migrate-guest-session-packs" },
  async ({ step }) => {
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

      const rawData = await res.json();
      const parsed = convexResponseSchema.safeParse(rawData);

      if (!parsed.success) {
        throw new Error(`Invalid Convex response: ${parsed.error.message}`);
      }

      return parsed.data.packs.map((pack) => ({
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
      try {
        await step.run(`migrate-pack-${pack.id}`, async () => {
          const clerkUserId = await getClerkUserIdByEmail(pack.email);

          if (!clerkUserId) {
            const emailDomain = pack.email.split("@")[1] ?? "unknown";
            await reportInfo({
              source: "inngest:migrate-guest-session-packs",
              message: "No Clerk user found for email domain",
              level: "warn",
              context: { packId: pack.id, emailDomain },
            });
            skipped++;
            return { status: "skipped" };
          }

          const sessionPackRes = await fetch(`${convexUrl}/api/internal/link-session-packs`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${convexHttpKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ clerkUserId, email: pack.email }),
          });

          if (!sessionPackRes.ok) {
            const errText = await sessionPackRes.text().catch(() => "unknown");
            throw new Error(`Failed to link session pack: ${sessionPackRes.status} ${errText}`);
          }

          const seatResRes = await fetch(`${convexUrl}/api/internal/link-seat-reservations`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${convexHttpKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ clerkUserId, email: pack.email }),
          });

          if (!seatResRes.ok) {
            const errText = await seatResRes.text().catch(() => "unknown");
            throw new Error(`Failed to link seat reservation: ${seatResRes.status} ${errText}`);
          }

          await reportInfo({
            source: "inngest:migrate-guest-session-packs",
            message: "Migrated session pack for user",
            level: "info",
            context: { packId: pack.id, clerkUserId },
          });

          migrated++;
          return { status: "migrated" };
        });
      } catch (err) {
        await step.run(`report-error-${pack.id}`, async () => {
          await reportError({
            source: "inngest:migrate-guest-session-packs",
            error: err instanceof Error ? err : new Error(String(err)),
            message: "Failed to migrate session pack",
            level: "error",
            context: { packId: pack.id },
          });
        });
        failed++;
      }
    }

    return { migrated, skipped, failed, total: guestSessionPacks.length };
  }
);