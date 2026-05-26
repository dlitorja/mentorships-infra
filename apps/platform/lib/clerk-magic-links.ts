import { clerkClient } from "@clerk/nextjs/server";
import { reportError, reportInfo } from "@/lib/observability";

/**
 * Send a Clerk email-link verification to an existing user's primary email address.
 *
 * Notes:
 * - Uses the backend client; does not modify Clerk config.
 * - Non-blocking usage is recommended from API routes (fire-and-forget).
 */
export async function sendEmailLinkForUser(
  userId: string,
  redirectUrl: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Feature flag: allow disabling in local dev/tests without code changes
  // ENABLE_MAGIC_LINKS=false will skip sending; default is enabled.
  if (process.env.ENABLE_MAGIC_LINKS === "false") {
    await reportInfo({
      source: "clerk/magic-links",
      message: "Magic link send skipped by flag",
      context: { userId, redirectUrl },
    });
    return { ok: true };
  }

  // Validate redirectUrl formatting and origin for basic safety. Never throw; only log.
  try {
    const url = new URL(redirectUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      await reportInfo({
        source: "clerk/magic-links",
        level: "warn",
        message: "Unexpected redirectUrl protocol",
        context: { userId, redirectUrl },
      });
    }
    // If NEXT_PUBLIC_URL/VERCEL_URL are set, warn on cross-origin
    const allowed = process.env.NEXT_PUBLIC_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
    if (allowed) {
      try {
        const allowedOrigin = new URL(allowed).origin;
        if (url.origin !== allowedOrigin) {
          await reportInfo({
            source: "clerk/magic-links",
            level: "warn",
            message: "redirectUrl origin mismatch",
            context: { userId, redirectUrl, allowedOrigin },
          });
        }
      } catch {
        // ignore bad allowed URL
      }
    }
  } catch {
    await reportInfo({
      source: "clerk/magic-links",
      level: "warn",
      message: "Invalid redirectUrl",
      context: { userId, redirectUrl },
    });
  }

  // Small exponential backoff with jitter for transient Clerk hiccups
  const maxAttempts = 3;
  const baseDelayMs = 200; // initial backoff

  // During unit tests, allow overriding the Clerk client without requiring real env
  declare global {
    // eslint-disable-next-line no-var
    var __TEST_CLERK_CLIENT__: Awaited<ReturnType<typeof clerkClient>> | undefined;
  }
  const override = globalThis.__TEST_CLERK_CLIENT__;
  const client = override ?? (await clerkClient());

  // Fetch user once; reuse primary email address id across retries
  let emailId: string | null = null;
  try {
    const user = await client.users.getUser(userId);
    const primaryId = (user as any).primaryEmailAddressId as string | undefined;
    const emailAddress = Array.isArray(user.emailAddresses)
      ? user.emailAddresses.find((e: any) => e.id === primaryId) ?? user.emailAddresses[0]
      : undefined;
    if (!emailAddress || !emailAddress.id) {
      return { ok: false, error: "User has no email address" };
    }
    emailId = emailAddress.id;
  } catch (error) {
    await reportError({
      source: "clerk/magic-links",
      error,
      message: "Failed to load user before sending magic link",
      level: "error",
      context: { userId },
    });
    return { ok: false, error: (error as any)?.message || "Failed to load user" };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Prefer the backend EmailAddress prepareVerification with email_link strategy
      // Clerk backend typed API supports preparing verification on email address objects
      // Cast to any for cross-version compatibility; some Clerk SDK versions expose this on emailAddresses
      await (client as any).emailAddresses.prepareVerification(emailId!, {
        strategy: "email_link",
        redirectUrl,
      } as any);

      await reportInfo({
        source: "clerk/magic-links",
        message: "Magic link sent",
        context: { userId, emailId, attempt },
      });
      return { ok: true };
    } catch (error: any) {
      const status = error?.status || error?.statusCode;
      const message = error?.message || String(error);

      // Do not retry on 4xx except 429 which can be retried
      const isTooMany = status === 429;
      const isRetryable = status == null || status >= 500 || isTooMany;

      await reportError({
        source: "clerk/magic-links",
        error,
        message: "Magic link send failed",
        level: isRetryable && attempt < maxAttempts ? "warn" : "error",
        context: { userId, attempt, status, retryable: isRetryable },
      });

      if (!isRetryable || attempt === maxAttempts) {
        return { ok: false, error: message };
      }

      // Exponential backoff with jitter
      const jitter = Math.floor(Math.random() * 100);
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
      await new Promise((res) => setTimeout(res, delay));
    }
  }

  // Should not reach here
  return { ok: false, error: "Unknown error" };
}
