import { inngest } from "../client";
import { reportInfo, reportError } from "@/lib/observability";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { convexServerCall } from "@/lib/convex-server-call";

function getConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return url;
}

function getConvexClient() {
  const url = getConvexUrl();
  return new ConvexHttpClient(url);
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

/**
 * Migrates guest session packs to Clerk users by looking up email addresses
 * in Clerk and linking the session packs and seat reservations to the found users.
 */
export const migrateGuestSessionPacks = inngest.createFunction(
  {
    id: "migrate-guest-session-packs",
    name: "Migrate Guest Session Packs",
    retries: 3,
  },
  { event: "migration/migrate-guest-session-packs" },
  async ({ step }) => {
    const convex = getConvexClient();

    const guestSessionPacks = await step.run("find-guest-session-packs", async () => {
      try {
        const result = await convex.query(api.migrationQueries.getGuestSessionPacks, {});

        return result.map((pack: { _id: string; userId: string }) => ({
          id: pack._id,
          userId: pack.userId,
          email: pack.userId.replace("email:", ""),
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to fetch guest session packs: ${message}`);
      }
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

    const packsByEmail = new Map<string, typeof guestSessionPacks>();
    for (const pack of guestSessionPacks) {
      const existing = packsByEmail.get(pack.email);
      if (existing) {
        existing.push(pack);
      } else {
        packsByEmail.set(pack.email, [pack]);
      }
    }

    let migrated = 0;
    let skipped = 0;
    let failed = 0;

    for (const [email, packs] of packsByEmail) {
      const packIds = packs.map((p) => p.id);
      try {
        const stepResult = await step.run(`migrate-pack-${packIds.join("-")}`, async () => {
          const clerkUserId = await getClerkUserIdByEmail(email);

          if (!clerkUserId) {
            const emailDomain = email.split("@")[1] ?? "unknown";
            await reportInfo({
              source: "inngest:migrate-guest-session-packs",
              message: "No Clerk user found for email domain",
              level: "warn",
              context: { packIds, emailDomain },
            });
            return { status: "skipped", packIds };
          }

          try {
            await convexServerCall("/internal/link-session-packs", {
              clerkUserId,
              email,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to link session packs: ${message}`);
          }

          try {
            await convexServerCall("/internal/link-seat-reservations", {
              clerkUserId,
              email,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to link seat reservations: ${message}`);
          }

          await reportInfo({
            source: "inngest:migrate-guest-session-packs",
            message: `Migrated ${packs.length} session pack(s) for user`,
            level: "info",
            context: { packIds, clerkUserId },
          });

          return { status: "migrated", packIds };
        });

        const status = stepResult.status;
        if (status === "migrated") {
          migrated += packs.length;
        } else if (status === "skipped") {
          skipped += packs.length;
        }
      } catch (err) {
        const errorPackId = packIds[0];
        await step.run(`report-error-${errorPackId}`, async () => {
          await reportError({
            source: "inngest:migrate-guest-session-packs",
            error: err instanceof Error ? err : new Error(String(err)),
            message: "Failed to migrate session pack",
            level: "error",
            context: { packIds },
          });
        });
        failed += packs.length;
      }
    }

    await step.run("report-final-status", async () => {
      await reportInfo({
        source: "inngest:migrate-guest-session-packs",
        message: `Migration complete: ${migrated} migrated, ${skipped} skipped, ${failed} failed`,
        level: failed > 0 ? "warn" : "info",
        context: { migrated, skipped, failed, total: guestSessionPacks.length },
      });
    });

    return { migrated, skipped, failed, total: guestSessionPacks.length };
  }
);