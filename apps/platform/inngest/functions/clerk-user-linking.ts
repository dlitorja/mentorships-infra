import { inngest } from "../client";
import { reportInfo } from "@/lib/observability";

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
 * Gets the Convex HTTP key from environment.
 * @throws Error if CONVEX_HTTP_KEY is not set
 */
function getConvexHttpKey(): string {
  const key = process.env.CONVEX_HTTP_KEY;
  if (!key) {
    throw new Error("CONVEX_HTTP_KEY is not set");
  }
  return key;
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
    const convexUrl = getConvexUrl();
    const convexHttpKey = getConvexHttpKey();

    let sessionPacksLinked = 0;
    let seatReservationsLinked = 0;

    const sessionPackResult = await step.run("link-session-packs", async () => {
      const res = await fetchWithTimeout(`${convexUrl}/internal/link-session-packs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${convexHttpKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ clerkUserId: userId, email: normalizedEmail }),
        timeoutMs: 10000,
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
    sessionPacksLinked = sessionPackResult?.linked ?? 0;

    const seatReservationResult = await step.run("link-seat-reservations", async () => {
      const res = await fetchWithTimeout(`${convexUrl}/internal/link-seat-reservations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${convexHttpKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ clerkUserId: userId, email: normalizedEmail }),
        timeoutMs: 10000,
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
    seatReservationsLinked = seatReservationResult?.linked ?? 0;

    return {
      linked: true,
      userId,
      sessionPacksLinked,
      seatReservationsLinked,
    };
  }
);