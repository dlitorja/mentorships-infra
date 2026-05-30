import { inngest } from "../client";
import { reportInfo, reportError } from "@/lib/observability";
import { z } from "zod";

/**
 * Fetches from a URL with a timeout using AbortController.
 * @param url - The URL to fetch
 * @param options - Fetch options including optional timeoutms
 * @param timeoutMs - Timeout in milliseconds (default 10000)
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

function getConvexHttpKey(): string {
  const key = process.env.CONVEX_HTTP_KEY;
  if (!key) {
    throw new Error("CONVEX_HTTP_KEY is not set");
  }
  return key;
}

function getConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return url;
}

const clerkUsersResponseSchema = z.array(z.object({ id: z.string() }));

/**
 * Looks up a Clerk user ID by email address.
 * Uses a 10 second timeout to prevent hanging.
 * @param email - The email to search for
 * @returns The Clerk user ID or null if not found
 */
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
    const convexHttpKey = getConvexHttpKey();
    const convexUrl = getConvexUrl();

    const guestSessionPacks = await step.run("find-guest-session-packs", async () => {
      const res = await fetchWithTimeout(`${convexUrl}/internal/guest-session-packs`, {
        headers: {
          Authorization: `Bearer ${convexHttpKey}`,
        },
        timeoutMs: 10000,
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch guest session packs: ${res.status}`);
      }

      const rawData = await res.json();
      const parsed = z
        .object({ packs: z.array(z.object({ _id: z.string(), userId: z.string() })) })
        .safeParse(rawData);

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

    // Track counts outside step.run callbacks so they persist across retries
    // Step results are memoized, so we track based on return value
    let migrated = 0;
    let skipped = 0;
    let failed = 0;

    for (const pack of guestSessionPacks) {
      try {
        const stepResult = await step.run(`migrate-pack-${pack.id}`, async () => {
          const clerkUserId = await getClerkUserIdByEmail(pack.email);

          if (!clerkUserId) {
            const emailDomain = pack.email.split("@")[1] ?? "unknown";
            await reportInfo({
              source: "inngest:migrate-guest-session-packs",
              message: "No Clerk user found for email domain",
              level: "warn",
              context: { packId: pack.id, emailDomain },
            });
            return { status: "skipped", packId: pack.id };
          }

          const sessionPackRes = await fetchWithTimeout(
            `${convexUrl}/internal/link-session-packs`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${convexHttpKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ clerkUserId, email: pack.email }),
              timeoutMs: 10000,
            }
          );

          if (!sessionPackRes.ok) {
            const errText = await sessionPackRes.text().catch(() => "unknown");
            throw new Error(`Failed to link session pack: ${sessionPackRes.status} ${errText}`);
          }

          const seatResRes = await fetchWithTimeout(
            `${convexUrl}/internal/link-seat-reservations`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${convexHttpKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ clerkUserId, email: pack.email }),
              timeoutMs: 10000,
            }
          );

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

          return { status: "migrated", packId: pack.id };
        });

        // Track based on step result status
        const status = stepResult.status;
        if (status === "migrated") {
          migrated++;
        } else if (status === "skipped") {
          skipped++;
        }
      } catch (err) {
        // Error in step.run - report it and mark as failed
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

    // Final report
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