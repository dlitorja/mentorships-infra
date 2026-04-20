import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM_ADDRESS = process.env.EMAIL_FROM || "Mentorships <onboarding@mentorships.com>";

export interface WaitlistNotificationData {
  instructorName: string;
  instructorSlug: string;
  mentorshipType: "oneOnOne" | "group";
  purchaseUrl: string;
}

export interface WaitlistEntry {
  id: string;
  email: string;
  createdAt: number;
  notifiedAt: number | null;
}

export async function sendWaitlistNotifications(
  entries: WaitlistEntry[],
  data: WaitlistNotificationData
): Promise<{ success: number; failed: number; error?: string }> {
  if (!resend) {
    console.error("Resend not configured - cannot send waitlist notifications");
    return { success: 0, failed: entries.length, error: "Resend not configured" };
  }

  if (entries.length === 0) {
    return { success: 0, failed: 0 };
  }

  const typeLabel = data.mentorshipType === "oneOnOne" ? "1-on-1" : "group";
  const subject = `Spot available! - ${data.instructorName}`;

  const emails = entries.map((entry) => ({
    from: FROM_ADDRESS,
    to: [entry.email],
    subject,
    html: buildWaitlistEmailHtml(data),
    text: buildWaitlistEmailText(data),
  }));

  try {
    const { data: result, error } = await resend.batch.send(emails, {
      idempotencyKey: `waitlist-notify-${data.instructorSlug}-${data.mentorshipType}-${Date.now()}`,
    });

    if (error) {
      console.error("Resend batch error:", error);
      return { success: 0, failed: entries.length, error: error.message };
    }

    return { success: entries.length, failed: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Failed to send waitlist notifications:", message);
    return { success: 0, failed: entries.length, error: message };
  }
}

function buildWaitlistEmailHtml(data: WaitlistNotificationData): string {
  const typeLabel = data.mentorshipType === "oneOnOne" ? "1-on-1 mentoring" : "group sessions";
  const purchaseUrl = data.purchaseUrl;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spot Available</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; padding: 40px 20px;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.07);">
            <!-- Header -->
            <tr>
              <td style="padding: 40px 40px 20px 40px; text-align: center;">
                <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #111827;">A spot just opened up!</h1>
              </td>
            </tr>
            <!-- Content -->
            <tr>
              <td style="padding: 20px 40px 40px 40px;">
                <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                  Hi there! Good news — a spot has opened up for <strong>${data.instructorName}</strong>'s ${typeLabel} program.
                </p>
                <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                  This is your chance to book sessions and start learning from a professional artist. Spots are limited and go fast!
                </p>
                <!-- CTA Button -->
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center">
                      <a href="${purchaseUrl}" style="display: inline-block; padding: 16px 32px; font-size: 16px; font-weight: 600; color: #ffffff; background-color: #2563eb; border-radius: 8px; text-decoration: none; transition: background-color 0.2s;">
                        Book Now
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin: 30px 0 0 0; font-size: 14px; line-height: 1.6; color: #6b7280;">
                  If you have any questions, just reply to this email.
                </p>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="padding: 20px 40px; background-color: #f9fafb; border-radius: 0 0 12px 12px; text-align: center;">
                <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                  You're receiving this because you signed up for the waitlist for ${data.instructorName}.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();
}

function buildWaitlistEmailText(data: WaitlistNotificationData): string {
  const typeLabel = data.mentorshipType === "oneOnOne" ? "1-on-1 mentoring" : "group sessions";
  const purchaseUrl = data.purchaseUrl;

  return `
A spot just opened up!

Hi there! Good news — a spot has opened up for ${data.instructorName}'s ${typeLabel} program.

This is your chance to book sessions and start learning from a professional artist. Spots are limited and go fast!

Book now: ${purchaseUrl}

If you have any questions, just reply to this email.

---
You're receiving this because you signed up for the waitlist for ${data.instructorName}.
  `.trim();
}