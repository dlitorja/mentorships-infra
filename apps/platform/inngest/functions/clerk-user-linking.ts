import { inngest } from "../client";
import { api } from "../../../../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { reportInfo } from "@/lib/observability";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

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

    await step.run("link-session-packs", async () => {
      const convex = getConvexClient();

      const result = await convex.mutation(api.sessionPacks.linkSessionPacksByEmail, {
        clerkUserId: userId,
        email: normalizedEmail,
      });

      await reportInfo({
        source: "inngest:clerk-user-linking",
        message: `Linked ${result.linked} session packs for user`,
        level: "info",
        context: {
          userId,
          emailDomain,
          linkedCount: result.linked,
        },
      });

      return result;
    });

    await step.run("link-seat-reservations", async () => {
      const convex = getConvexClient();

      const result = await convex.mutation(api.seatReservations.linkSeatReservationsByEmail, {
        clerkUserId: userId,
        email: normalizedEmail,
      });

      await reportInfo({
        source: "inngest:clerk-user-linking",
        message: `Linked ${result.linked} seat reservations for user`,
        level: "info",
        context: {
          userId,
          emailDomain,
          linkedCount: result.linked,
        },
      });

      return result;
    });

    return {
      linked: true,
      userId,
    };
  }
);