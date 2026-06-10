import { inngest } from "../client";
import { reportInfo } from "@/lib/observability";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

/**
 * Gets the Convex URL from environment.
 * @throws Error if NEXT_PUBLIC_CONVEX_URL is not set
 */
function getConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return url;
}

/**
 * Gets the Convex server shared secret from environment.
 * @throws Error if CONVEX_SERVER_SHARED_SECRET is not set
 */
function getConvexSecret(): string {
  const secret = process.env.CONVEX_SERVER_SHARED_SECRET;
  if (!secret) {
    throw new Error("CONVEX_SERVER_SHARED_SECRET is not set");
  }
  return secret;
}

function getConvexClient() {
  const url = getConvexUrl();
  return new ConvexHttpClient(url);
}

/**
 * Links a Clerk user to their session packs and seat reservations
 * after the user is created in Clerk.
 */
export const linkClerkUserToSessionPacks = inngest.createFunction(
  {
    id: "link-clerk-user-to-session-packs",
    name: "Link Clerk User to Session Packs",
    retries: 3,
  },
  { event: "clerk/user.created" },
  async ({ event, step }) => {
    const { userId, email } = event.data;

    if (!userId || typeof userId !== "string") {
      return {
        linked: false,
        reason: "Invalid or missing userId",
        sessionPacksLinked: 0,
        seatReservationsLinked: 0,
      };
    }

    if (!email || typeof email !== "string") {
      await reportInfo({
        source: "inngest:clerk-user-linking",
        message: "No email in event data, skipping",
        level: "warn",
        context: { userId },
      });
      return {
        linked: false,
        reason: "No email in event data, skipping",
        sessionPacksLinked: 0,
        seatReservationsLinked: 0,
      };
    }

    const normalizedEmail = email.toLowerCase().trim();
    const emailDomain = normalizedEmail.split("@")[1] ?? "unknown";
    const convex = getConvexClient();
    const secret = getConvexSecret();

    let sessionPacksLinked = 0;
    let seatReservationsLinked = 0;

    const sessionPackResult = await step.run("link-session-packs", async () => {
      try {
        const result = await convex.mutation(api.sessionPacks.linkSessionPacksByEmailAction, {
          clerkUserId: userId,
          email: normalizedEmail,
          secret,
        });

        await reportInfo({
          source: "inngest:clerk-user-linking",
          message: `Linked ${result?.linked ?? 0} session packs for user`,
          level: "info",
          context: {
            userId,
            emailDomain,
            linkedCount: result?.linked ?? 0,
          },
        });

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to link session packs: ${message}`);
      }
    });
    sessionPacksLinked = sessionPackResult?.linked ?? 0;

    const seatReservationResult = await step.run("link-seat-reservations", async () => {
      try {
        const result = await convex.mutation(api.seatReservations.linkSeatReservationsByEmailAction, {
          clerkUserId: userId,
          email: normalizedEmail,
          secret,
        });

        await reportInfo({
          source: "inngest:clerk-user-linking",
          message: `Linked ${result?.linked ?? 0} seat reservations for user`,
          level: "info",
          context: {
            userId,
            emailDomain,
            linkedCount: result?.linked ?? 0,
          },
        });

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to link seat reservations: ${message}`);
      }
    });
    seatReservationsLinked = seatReservationResult?.linked ?? 0;

    return {
      linked: true,
      userId,
      sessionPacksLinked,
      seatReservationsLinked,
    };
  }
);