import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

type NotificationSendResult = {
  success: boolean;
  type: string;
  userId: string;
  sessionPackId: string;
  email: { ok: boolean; skipped: boolean; reason: string | null };
  discord: { ok: boolean; skipped: boolean; reason?: string | null; error?: string | null };
};

function getBaseUrl(): string {
  if (typeof process !== "undefined" && process.env.APP_URL) {
    return process.env.APP_URL;
  }
  if (typeof process !== "undefined" && process.env.CONVEX_SITE_URL) {
    return process.env.CONVEX_SITE_URL;
  }
  if (typeof process !== "undefined" && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

function getCtaUrl(): string {
  return `${getBaseUrl()}/instructors`;
}

function buildNotificationEmail(data: {
  type: string;
  message: string;
  sessionNumber?: number;
  gracePeriodEndsAt?: Date;
  sessionPackId?: string;
}): { subject: string; html: string; text: string; headers: Record<string, string> } {
  const ctaUrl = getCtaUrl();
  let subject: string;
  let title: string;

  switch (data.type) {
    case "renewal_reminder":
      subject = "1 session left — renew now to keep momentum";
      title = "Renewal reminder";
      break;
    case "final_renewal_reminder":
      subject = "Your pack is complete — renew within 72 hours to keep your seat";
      title = "Final renewal reminder";
      break;
    case "grace_period_final_warning":
      subject = "Final warning: your seat will be released soon";
      title = "Grace period ending soon";
      break;
    default:
      subject = "Notification from Huckleberry Mentorships";
      title = "Notification";
  }

  const graceLine = data.gracePeriodEndsAt
    ? `Grace period ends: ${data.gracePeriodEndsAt.toLocaleString("en-US", { timeZone: "UTC" })} UTC`
    : null;

  const sessionLine =
    typeof data.sessionNumber === "number" ? `Session number: ${data.sessionNumber}` : null;

  const text = [
    title,
    "",
    data.message,
    "",
    sessionLine,
    graceLine,
    "",
    `Renew here: ${ctaUrl}`,
    "",
    "If you have any trouble, reply to this email and we'll help.",
  ]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px">${title}</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">${escapeHtml(data.message)}</div>
        ${
          sessionLine
            ? `<div style="color:#6B7280;font-size:12px;margin-bottom:6px">${escapeHtml(sessionLine)}</div>`
            : ""
        }
        ${
          graceLine
            ? `<div style="color:#6B7280;font-size:12px;margin-bottom:12px">${escapeHtml(graceLine)}</div>`
            : ""
        }
        <a href="${ctaUrl}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Renew now</a>
        <p style="margin:16px 0 0 0;color:#6B7280;font-size:12px">
          If the button doesn't work, copy/paste this link:<br/>
          <div>${ctaUrl}</div>
        </p>
      </div>
    </div>
  `.trim();

  return {
    subject,
    html,
    text,
    headers: {
      "X-Notification-Type": data.type,
      "X-Session-Pack-Id": data.sessionPackId ?? "",
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildNotificationDiscordMessage(data: {
  type: string;
  message: string;
}): string {
  const prefix =
    data.type === "renewal_reminder"
      ? "Renewal reminder"
      : data.type === "final_renewal_reminder"
        ? "Final renewal reminder"
        : data.type === "grace_period_final_warning"
          ? "Grace period ending soon"
          : "Notification";

  return `${prefix}:\n\n${data.message}`.trim();
}

class DiscordApiError extends Error {
  public readonly status: number;
  constructor(args: { message: string; status: number }) {
    super(args.message);
    this.name = "DiscordApiError";
    this.status = args.status;
  }
}

function getDiscordBotToken(): string | null {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || token.trim().length === 0) return null;
  return token.trim();
}

function capDiscordMessageContent(content: string): string {
  if (content.length <= 2000) return content;
  return `${content.slice(0, 1997)}...`;
}

async function discordRequest<T>(args: {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
}): Promise<T> {
  const token = getDiscordBotToken();
  if (!token) {
    throw new DiscordApiError({ status: 0, message: "DISCORD_BOT_TOKEN is not configured" });
  }

  const url = `https://discord.com/api/v10${args.path.startsWith("/") ? args.path : `/${args.path}`}`;
  const res = await fetch(url, {
    method: args.method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore parse errors
  }

  if (!res.ok) {
    const message =
      typeof json === "object" && json && "message" in json && typeof (json as { message?: unknown }).message === "string"
        ? (json as { message: string }).message
        : `Discord API request failed: ${res.status}`;
    throw new DiscordApiError({ status: res.status, message });
  }

  return (json as T) ?? (null as T);
}

async function createDmChannel(discordUserId: string): Promise<{ id: string }> {
  return await discordRequest<{ id: string }>({
    method: "POST",
    path: "/users/@me/channels",
    body: { recipient_id: discordUserId },
  });
}

async function sendDmInternal(args: { discordUserId: string; content: string }): Promise<{ messageId: string }> {
  const channel = await createDmChannel(args.discordUserId);
  const res = await discordRequest<{ id: string }>({
    method: "POST",
    path: `/channels/${channel.id}/messages`,
    body: { content: capDiscordMessageContent(args.content) },
  });
  return { messageId: res.id };
}

function getResendClient(): { apiKey: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return { apiKey };
}

function getFromAddress(): string | null {
  return process.env.EMAIL_FROM ?? null;
}

async function sendEmailInternal(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}): Promise<{ ok: true; id: string | null } | { ok: false; skipped: true; reason: string } | { ok: false; error: string }> {
  const client = getResendClient();
  if (!client) {
    return { ok: false, skipped: true, reason: "resend_not_configured" };
  }

  const from = getFromAddress();
  if (!from) {
    return { ok: false, skipped: true, reason: "email_from_not_configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${client.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
        headers: args.headers,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { ok: false, error: `Resend API error: ${response.status} - ${errorText}` };
    }

    const responseData = await response.json();
    return { ok: true, id: responseData.id ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

type NotificationType = "renewal_reminder" | "final_renewal_reminder" | "grace_period_final_warning";

type NotificationPayload = {
  type: NotificationType;
  userId: string;
  sessionPackId: string;
  message: string;
  sessionNumber?: number;
  gracePeriodEndsAt?: number;
};


export const handleNotificationSend = internalAction({
  args: {
    payload: v.object({
      type: v.union(v.literal("renewal_reminder"), v.literal("final_renewal_reminder"), v.literal("grace_period_final_warning")),
      userId: v.string(),
      sessionPackId: v.string(),
      message: v.string(),
      sessionNumber: v.optional(v.number()),
      gracePeriodEndsAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args): Promise<NotificationSendResult> => {
    const { payload } = args;

    const user = await ctx.runQuery(internal.users.getUserByClerkId, { userId: payload.userId });

    const emailAddress = user?.email ?? null;

    const discordIdentity = await ctx.runQuery(internal.userIdentities.getByUserIdAndProvider, {
      userId: payload.userId,
      provider: "discord",
    });

    const discordUserId = discordIdentity?.providerUserId ?? null;

    const emailContent = buildNotificationEmail({
      type: payload.type,
      message: payload.message,
      sessionNumber: payload.sessionNumber,
      gracePeriodEndsAt: payload.gracePeriodEndsAt ? new Date(payload.gracePeriodEndsAt) : undefined,
    });

    const emailResult = emailAddress
      ? await sendEmailInternal({
          to: emailAddress,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          headers: emailContent.headers,
        })
      : ({ ok: false as const, skipped: true as const, reason: "missing_email" as const });

    let discordResult: { ok: boolean; skipped?: boolean; reason?: string; messageId?: string; error?: string } = { ok: false, skipped: true, reason: "missing_discord_identity" };
    if (discordUserId) {
      try {
        const msg = buildNotificationDiscordMessage(payload);
        const res = await sendDmInternal({ discordUserId, content: msg });
        discordResult = { ok: true, messageId: res.messageId };
      } catch (err) {
        if (err instanceof DiscordApiError && err.status === 0) {
          discordResult = { ok: false, skipped: true, reason: "discord_not_configured" };
        } else {
          discordResult = { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
        }
      }
    }

    return {
      success: emailResult.ok || discordResult.ok,
      type: payload.type,
      userId: payload.userId,
      sessionPackId: payload.sessionPackId,
      email: {
        ok: emailResult.ok,
        skipped: !emailResult.ok && "skipped" in emailResult ? emailResult.skipped === true : false,
        reason: !emailResult.ok && "reason" in emailResult ? emailResult.reason : null,
      },
      discord: {
        ok: discordResult.ok,
        skipped: !discordResult.ok && "skipped" in discordResult ? discordResult.skipped === true : false,
        reason: !discordResult.ok && "reason" in discordResult ? discordResult.reason : null,
        error: !discordResult.ok && "error" in discordResult ? discordResult.error : null,
      },
    };
  },
});