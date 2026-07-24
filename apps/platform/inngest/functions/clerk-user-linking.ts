import { inngest } from "../client";
import { reportInfo } from "@/lib/observability";
import { convexServerCall } from "@/lib/convex-server-call";

/**
 * Links a Clerk user to their session packs and seat reservations
 * after the user is created in Clerk.
 *
 * Authentication: the worker POSTs to the bearer-auth Convex HTTP
 * endpoints `/internal/link-session-packs` and
 * `/internal/link-seat-reservations` using `CONVEX_HTTP_KEY`. The
 * legacy `CONVEX_SERVER_SHARED_SECRET` auth path has been removed in
 * favour of the shared HTTP bearer (R14 secret-removal).
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

    let sessionPacksLinked = 0;
    let seatReservationsLinked = 0;

    const sessionPackResult = await step.run("link-session-packs", async () => {
      try {
        const result = await convexServerCall<{ linked?: number }>(
          "/internal/link-session-packs",
          {
            clerkUserId: userId,
            email: normalizedEmail,
          }
        );

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
        const result = await convexServerCall<{ linked?: number }>(
          "/internal/link-seat-reservations",
          {
            clerkUserId: userId,
            email: normalizedEmail,
          }
        );

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
