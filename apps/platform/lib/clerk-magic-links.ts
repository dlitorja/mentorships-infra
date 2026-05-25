import { clerkClient } from "@clerk/nextjs/server";

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
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const emailAddress = user.emailAddresses?.[0];
    if (!emailAddress) {
      return { ok: false, error: "User has no email address" };
    }
    // Prefer the backend EmailAddress prepareVerification with email_link strategy
    // Clerk backend typed API supports preparing verification on email address objects
    await client.emailAddresses.prepareVerification(emailAddress.id, {
      strategy: "email_link",
      redirectUrl,
    } as any);
    return { ok: true };
  } catch (error: any) {
    const message = error?.message || String(error);
    console.error("[clerk] Failed to send email link:", message);
    return { ok: false, error: message };
  }
}
