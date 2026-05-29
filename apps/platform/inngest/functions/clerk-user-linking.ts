import { inngest } from "../client";
import { reportInfo } from "@/lib/observability";

function getConvexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return url;
}

function getConvexHttpKey() {
  const key = process.env.CONVEX_HTTP_KEY;
  if (!key) {
    throw new Error("CONVEX_HTTP_KEY is not set");
  }
  return key;
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
    const convexUrl = getConvexUrl();
    const convexHttpKey = getConvexHttpKey();

    await step.run("link-session-packs", async () => {
      const res = await fetch(`${convexUrl}/internal/link-session-packs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${convexHttpKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ clerkUserId: userId, email: normalizedEmail }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "unknown");
        throw new Error(`Failed to link session packs: ${res.status} ${errText}`);
      }

      const result = await res.json();

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
      const res = await fetch(`${convexUrl}/internal/link-seat-reservations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${convexHttpKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ clerkUserId: userId, email: normalizedEmail }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "unknown");
        throw new Error(`Failed to link seat reservations: ${res.status} ${errText}`);
      }

      const result = await res.json();

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