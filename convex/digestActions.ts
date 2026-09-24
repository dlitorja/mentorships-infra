"use node";

/**
 * PR 7: digest send action. Lives in its own file because Convex's
 * `"use node"` directive only permits action exports — query /
 * mutation / helper code lives in `convex/digest.ts`. The HTTP
 * endpoint that the Inngest cron uses (`convex/http.ts:httpSendDigest`)
 * wraps the scheduled action.
 */

import { action, internalAction } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { internal, api } from "./_generated/api";
import { z } from "zod";

const RESEND_RESPONSE_SCHEMA = z.object({ id: z.string() });

const RESEND_API_URL = "https://api.resend.com/emails";

type Frequency = "daily" | "weekly" | "monthly";

/**
 * Resolves the Resend sender address. Marketing uses the marketing
 * sender if set, else the transactional sender, else the staging sender.
 * Mirrors `apps/marketing/lib/email/client.ts:getFromAddress` exactly
 * so a manual digest looks identical to an Inngest-driven one.
 */
function resolveFromAddress(): string {
  return (
    process.env.EMAIL_FROM_MARKETING ??
    process.env.EMAIL_FROM_TRANSACTIONAL ??
    process.env.EMAIL_FROM_STAGING ??
    ""
  );
}

/**
 * Period-window helper for daily/weekly/monthly digests. Mirrors
 * `apps/marketing/lib/digest-data.ts:getPeriodForDigest` so the
 * digest email subject line and counts match the previous
 * Supabase-backed output exactly.
 *
 * Pure JS — runs in any context. Lives next to the action so the
 * caller doesn't need to compute the window client-side.
 */
function getPeriodForDigest(
  frequency: Frequency,
  baseDate: Date = new Date()
): { start: Date; end: Date } {
  const end = new Date(baseDate);
  const start = new Date(baseDate);

  switch (frequency) {
    case "daily":
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case "weekly": {
      const dayOfWeek = start.getDay();
      const diff = start.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      start.setDate(diff);
      start.setHours(0, 0, 0, 0);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case "monthly":
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(start.getMonth() + 1);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
      break;
  }

  return { start, end };
}

/**
 * Build the digest email body. Re-implementation of the canonical
 * `packages/emails/src/weekly-digest.ts` builder, inlined here
 * because the Convex bundler sandboxes `convex/` and refuses
 * relative imports outside it (esbuild "Could not resolve"). The
 * two implementations MUST stay byte-identical: any drift breaks
 * the parity assertion in §4f. The long-term answer is a shared
 * `packages/email-templates` workspace package (see §4f
 * limitation #2).
 */
function buildWeeklyDigestEmail(data: {
  periodStart: string;
  periodEnd: string;
  waitlistSignups: Array<{
    instructorName: string;
    mentorshipType: "one-on-one" | "group";
    email: string;
    createdAt: string;
  }>;
  inventoryStatus: Array<{
    instructorName: string;
    oneOnOneInventory: number;
    groupInventory: number;
  }>;
  notificationsSent: Array<{
    instructorName: string;
    mentorshipType: "one-on-one" | "group";
    count: number;
    sentAt: string;
  }>;
  inventoryChanges: Array<{
    instructorName: string;
    type: "manual_update" | "kajabi_purchase";
    mentorshipType: "one-on-one" | "group" | null;
    before: number;
    after: number;
    changedAt: string;
  }>;
  conversions: Array<{
    instructorName: string;
    mentorshipType: "one-on-one" | "group";
    waitlistDuration: number;
    purchasedAt: string;
  }>;
}): { subject: string; html: string; text: string; headers: Record<string, string> } {
  const escapeHtml = (v: string) =>
    v
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const sanitizeHeaderValue = (v: string) =>
    v.replace(/[\r\n]/g, "").replace(/[\x00-\x1F\x7F]/g, "");

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const { periodStart, periodEnd } = data;
  const periodRange = `${formatDate(periodStart)} - ${formatDate(periodEnd)}`;
  const subject = `Weekly Digest: ${periodRange}`;

  const text = [
    "Huckleberry Mentorships Weekly Digest",
    "",
    `${periodRange}`,
    `Waitlist Signups: ${data.waitlistSignups.length} new`,
    `Emails Sent: ${data.notificationsSent.reduce((sum, n) => sum + n.count, 0)}`,
    `Conversions: ${data.conversions.length} waitlist users purchased`,
    "",
    "Sign in to your admin dashboard for full details.",
    "",
    "---",
    "",
    "Waitlist Signups:",
    ...data.waitlistSignups.map(
      (s) =>
        `- ${s.email} joined ${s.instructorName}'s ${s.mentorshipType} waitlist (${formatDate(s.createdAt)})`,
    ),
    "",
    "Inventory Changes:",
    ...data.inventoryChanges.map(
      (c) =>
        `- ${c.type}: ${c.instructorName} ${c.mentorshipType || "inventory"} ${c.before} → ${c.after}`,
    ),
  ].join("\n");

  const waitlistSignupsHtml =
    data.waitlistSignups.length > 0
      ? `
    <div style="margin-bottom:32px">
      <div style="font-weight:700;margin-bottom:12px;font-size:16px;color:#111827">
        Waitlist Signups (${data.waitlistSignups.length} new)
      </div>
      <div style="background:#F9FAFB;border-radius:8px;padding:16px">
        ${data.waitlistSignups.slice(0, 10).map((signup, index) => `
          <div style="padding:8px 0;${index === Math.min(data.waitlistSignups.length - 1, 9) ? '' : 'border-bottom:1px solid #E5E7EB'}">
            <div style="font-weight:500;color:#111827">${escapeHtml(signup.email)}</div>
            <div style="font-size:13px;color:#6B7280">
              ${escapeHtml(signup.instructorName)} • ${signup.mentorshipType === "one-on-one" ? "1-on-1" : "Group"} • ${formatDate(signup.createdAt)}
            </div>
          </div>
        `).join("")}
        ${data.waitlistSignups.length > 10
          ? `<div style="padding:12px 0 0 0;font-size:13px;color:#6B7280">+${data.waitlistSignups.length - 10} more signups</div>`
          : ""
        }
      </div>
    </div>
    `
      : "";

  const notificationsHtml =
    data.notificationsSent.length > 0
      ? `
    <div style="margin-bottom:32px">
      <div style="font-weight:700;margin-bottom:12px;font-size:16px;color:#111827">
        Notifications Sent (${data.notificationsSent.reduce((sum, n) => sum + n.count, 0)} emails)
      </div>
      ${data.notificationsSent.map((notif, index) => `
        <div style="padding:12px 0;${index === data.notificationsSent.length - 1 ? '' : 'border-bottom:1px solid #E5E7EB'}">
          <div style="font-weight:500;color:#111827">${escapeHtml(notif.instructorName)} • ${notif.mentorshipType === "one-on-one" ? "1-on-1" : "Group"}</div>
          <div style="font-size:13px;color:#6B7280">${notif.count} waitlist users notified • ${formatDate(notif.sentAt)}</div>
        </div>
      `).join("")}
    </div>
    `
      : "";

  const inventoryChangesHtml =
    data.inventoryChanges.length > 0
      ? `
    <div style="margin-bottom:32px">
      <div style="font-weight:700;margin-bottom:12px;font-size:16px;color:#111827">
        Inventory Changes (${data.inventoryChanges.length} events)
      </div>
      ${data.inventoryChanges.map((change, index) => {
        const typeLabel = change.type === "manual_update" ? "Manual Update" : "Kajabi Purchase";
        const changeColor = change.after > change.before ? "#059669" : change.after < change.before ? "#DC2626" : "#6B7280";
        const changeArrow = change.after > change.before ? "↑" : change.after < change.before ? "↓" : "→";
        return `
          <div style="padding:12px 0;${index === data.inventoryChanges.length - 1 ? '' : 'border-bottom:1px solid #E5E7EB'}">
            <div style="font-weight:500;color:#111827">${escapeHtml(change.instructorName)} ${change.mentorshipType ? `(${change.mentorshipType === "one-on-one" ? "1-on-1" : "Group"})` : ""}</div>
            <div style="font-size:13px;color:#6B7280">
              ${typeLabel} • ${change.before} <span style="color:${changeColor};font-weight:600">${changeArrow}</span> ${change.after} • ${formatDate(change.changedAt)}
            </div>
          </div>
        `;
      }).join("")}
    </div>
    `
      : "";

  const conversionsHtml =
    data.conversions.length > 0
      ? `
    <div style="margin-bottom:32px">
      <div style="font-weight:700;margin-bottom:12px;font-size:16px;color:#111827">
        Conversions (${data.conversions.length} waitlist users purchased)
      </div>
      ${data.conversions.map((conv, index) => `
        <div style="padding:12px 0;${index === data.conversions.length - 1 ? '' : 'border-bottom:1px solid #E5E7EB'}">
          <div style="font-weight:500;color:#111827">${escapeHtml(conv.instructorName)} • ${conv.mentorshipType === "one-on-one" ? "1-on-1" : "Group"}</div>
          <div style="font-size:13px;color:#6B7280">
            Waitlisted for ${conv.waitlistDuration} days • Purchased ${formatDate(conv.purchasedAt)}
          </div>
        </div>
      `).join("")}
    </div>
    `
      : "";

  const inventoryStatusHtml =
    data.inventoryStatus.length > 0
      ? `
    <div style="margin-bottom:32px">
      <div style="font-weight:700;margin-bottom:12px;font-size:16px;color:#111827">Current Inventory Status</div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:2px solid #E5E7EB">
            <th style="text-align:left;padding:12px 8px;color:#6B7280;font-weight:600;font-size:13px">Instructor</th>
            <th style="text-align:center;padding:12px 8px;color:#6B7280;font-weight:600;font-size:13px">1-on-1</th>
            <th style="text-align:center;padding:12px 8px;color:#6B7280;font-weight:600;font-size:13px">Group</th>
            <th style="text-align:center;padding:12px 8px;color:#6B7280;font-weight:600;font-size:13px">Status</th>
          </tr>
        </thead>
        <tbody>
          ${data.inventoryStatus.map((inv, index) => {
            const isOutOfStock = inv.oneOnOneInventory === 0 && inv.groupInventory === 0;
            return `
              <tr style="border-bottom:1px solid #F3F4F6">
                <td style="padding:12px 8px;color:#111827;font-weight:500">${escapeHtml(inv.instructorName)}</td>
                <td style="text-align:center;padding:12px 8px;color:#111827">${inv.oneOnOneInventory}</td>
                <td style="text-align:center;padding:12px 8px;color:#111827">${inv.groupInventory}</td>
                <td style="text-align:center;padding:12px 8px">
                  ${isOutOfStock
                    ? '<span style="display:inline-block;padding:4px 12px;background:#FEF2F2;color:#DC2626;border-radius:9999px;font-size:12px;font-weight:600">Waitlist Active</span>'
                    : '<span style="display:inline-block;padding:4px 12px;background:#ECFDF5;color:#059669;border-radius:9999px;font-size:12px;font-weight:600">Available</span>'
                  }
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
    `
      : "";

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:8px">Huckleberry Mentorships</div>
      <div style="font-size:14px;color:#6B7280;margin-bottom:24px">Weekly Digest</div>

      <div style="background:#F3F4F6;border-radius:12px;padding:20px;margin-bottom:32px">
        <div style="font-size:24px;font-weight:700;margin-bottom:4px">${periodRange}</div>
        <div style="font-size:14px;color:#6B7280">Waitlist & Inventory Overview</div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:32px">
        <div style="background:#111827;border-radius:12px;padding:16px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#fff;margin-bottom:4px">${data.waitlistSignups.length}</div>
          <div style="font-size:12px;color:#9CA3AF">New Signups</div>
        </div>
        <div style="background:#111827;border-radius:12px;padding:16px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#fff;margin-bottom:4px">${data.notificationsSent.reduce((sum, n) => sum + n.count, 0)}</div>
          <div style="font-size:12px;color:#9CA3AF">Emails Sent</div>
        </div>
        <div style="background:#111827;border-radius:12px;padding:16px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#fff;margin-bottom:4px">${data.conversions.length}</div>
          <div style="font-size:12px;color:#9CA3AF">Conversions</div>
        </div>
      </div>

      ${waitlistSignupsHtml}
      ${notificationsHtml}
      ${inventoryChangesHtml}
      ${conversionsHtml}
      ${inventoryStatusHtml}

      <div style="padding:24px 0;border-top:1px solid #E5E7EB;margin-top:32px">
        <div style="font-size:14px;color:#6B7280;text-align:center">
          <a href="#" style="color:#6B7280;text-decoration:underline">View Full Admin Dashboard</a>
        </div>
      </div>
    </div>
  `.trim();

  return {
    subject,
    html,
    text,
    headers: {
      "X-Notification-Type": "weekly-digest",
      "X-Period-Start": sanitizeHeaderValue(periodStart),
      "X-Period-End": sanitizeHeaderValue(periodEnd),
      "X-New-Signups": String(data.waitlistSignups.length),
      "X-Emails-Sent": String(data.notificationsSent.reduce((sum, n) => sum + n.count, 0)),
      "X-Conversions": String(data.conversions.length),
    },
  };
}

/**
 * Shared implementation called by both the public admin action
 * (`sendAdminDigestEmail`) and the Inngest-scheduled internal
 * action (`internalSendScheduledDigest`). Both are essentially
 * "build the report, send the email, mark `lastSentAt`" — the only
 * difference is which admin-gate they pass and whether cadence is
 * enforced (cadence is only enforced on the scheduled path).
 *
 * Reads use internal queries (no auth check) because the caller
 * already authenticated: the public action's admin gate, or the
 * HTTP endpoint's CONVEX_HTTP_KEY gate.
 */
async function sendDigest(
  ctx: {
    runQuery: (ref: any, args: any) => Promise<any>;
    runMutation: (ref: any, args: any) => Promise<any>;
  },
  apiKey: string,
  from: string,
  /**
   * Caller-provided key used for Resend's `Idempotency-Key` header.
   * MUST be unique per logical send invocation (not per period).
   *
   * - Inngest scheduled send: pass `digest-${cronTimestamp}` so
   *   retries of the same cron tick dedup, but distinct cron ticks
   *   (and any overlapping manual "Send Now") send fresh emails.
   * - UI manual send: pass a fresh `crypto.randomUUID()` per click;
   *   the UI does not retry, so dedup is not needed.
   *
   * When omitted, a random UUID is generated per invocation —
   * effectively disabling Resend dedup. This is correct for
   * non-retrying callers but loses the retry protection that the
   * scheduled path relies on, so callers SHOULD always pass an
   * explicit key.
   */
  idempotencyKey: string = crypto.randomUUID()
): Promise<{
  success: true;
  message: string;
  recipientEmail: string;
  periodStart: string;
  periodEnd: string;
  newSignups: number;
  emailsSent: number;
  conversions: number;
  emailId: string;
}> {
  // 1) Read settings via internal query (no auth check; caller is trusted).
  const settings = await ctx.runQuery(
    internal.digest.internalGetAdminDigestSettings,
    {}
  );

  // 2) Compute period window from frequency.
  const period = getPeriodForDigest(settings.frequency);

  // 3) Read report sections in parallel — 4 indexed reads + 1 inventory.
  const [inventoryStatus, signups, notifications, changes] = await Promise.all([
    ctx.runQuery(internal.digest.internalGetInventoryStatusForDigest, {}),
    ctx.runQuery(internal.digest.internalGetWaitlistSignupsForPeriod, {
      periodStart: period.start.getTime(),
      periodEnd: period.end.getTime(),
    }),
    ctx.runQuery(internal.digest.internalGetNotificationsSentForPeriod, {
      periodStart: period.start.getTime(),
      periodEnd: period.end.getTime(),
    }),
    ctx.runQuery(internal.digest.internalGetInventoryChangesForPeriod, {
      periodStart: period.start.getTime(),
      periodEnd: period.end.getTime(),
    }),
  ]);

  // 4) Aggregate notifications by `(instructorSlug, mentorshipType)`
  //    exactly like the Supabase code did (`digest-data.ts:112`).
  const notifMap = new Map<string, { count: number; sentAt: number }>();
  for (const n of notifications) {
    const key = `${n.instructorSlug}|${n.mentorshipType}`;
    const existing = notifMap.get(key);
    if (existing) {
      existing.count++;
      existing.sentAt = Math.max(existing.sentAt, n.notifiedAt);
    } else {
      notifMap.set(key, { count: 1, sentAt: n.notifiedAt });
    }
  }
  const slugToName = new Map(
    inventoryStatus.map((i: any) => [i.instructorSlug, i.instructorName])
  );
  const notificationsSent = Array.from(notifMap.entries()).map(([key, val]) => {
    const [slug, mt] = key.split("|");
    const mentorshipType: "one-on-one" | "group" =
      mt === "group" ? "group" : "one-on-one";
    return {
      instructorName: slugToName.get(slug) ?? slug,
      mentorshipType,
      count: val.count,
      sentAt: new Date(val.sentAt).toISOString(),
    };
  });

  // 5) Format signups + changes for the email body.
  const waitlistSignups = signups.map((s: any) => ({
    instructorName: slugToName.get(s.instructorSlug) ?? s.instructorSlug,
    mentorshipType:
      s.mentorshipType === "group" ? "group" : "one-on-one",
    email: s.email,
    createdAt: new Date(s.createdAt).toISOString(),
  }));
  const inventoryChanges = changes.map((c: any) => ({
    instructorName: slugToName.get(c.instructorSlug) ?? c.instructorSlug,
    type: c.changeType,
    mentorshipType: c.mentorshipType
      ? c.mentorshipType === "group"
        ? "group"
        : "one-on-one"
      : null,
    before: c.oldValue,
    after: c.newValue,
    changedAt: new Date(c.changedAt).toISOString(),
  }));

  // 6) Build the email body. Empty `conversions` matches the
  //    Supabase output exactly (no logic populates it).
  const report = {
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    waitlistSignups,
    inventoryStatus: inventoryStatus.map((i: { instructorName: string; oneOnOneInventory: number; groupInventory: number }) => ({
      instructorName: i.instructorName,
      oneOnOneInventory: i.oneOnOneInventory,
      groupInventory: i.groupInventory,
    })),
    notificationsSent: notificationsSent.map((n) => ({
      instructorName: n.instructorName as string,
      mentorshipType: n.mentorshipType,
      count: n.count,
      sentAt: n.sentAt,
    })),
    inventoryChanges,
    conversions: [],
  };

  const emailContent = buildWeeklyDigestEmail(report);

  // 7) Send via Resend with a caller-provided `Idempotency-Key` so
  //    retries of the SAME invocation (e.g. an Inngest retry of the
  //    same cron tick that failed before Resend completed) do not
  //    deliver the email twice. Resend dedupes on this key for 24h.
  //
  //    The key is intentionally NOT derived from the period+recipient:
  //    that would cause a manual "Send Now" and a scheduled cron in
  //    the same period to share the same key, so Resend would dedupe
  //    a legitimate scheduled delivery.
  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from,
      to: [settings.adminEmail],
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      headers: emailContent.headers,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new ConvexError({
      code: "RESEND_SEND_FAILED",
      message: `Resend digest send failed (${res.status}): ${errText.slice(0, 500)}`,
    });
  }
  const resendData = RESEND_RESPONSE_SCHEMA.safeParse(await res.json().catch(() => ({})));
  if (!resendData.success) {
    throw new ConvexError({
      code: "RESEND_INVALID_RESPONSE",
      message: "Resend returned 2xx without a valid { id: string } payload",
    });
  }
  const emailId = resendData.data.id;

  // 8) Mark `lastSentAt` on success. Failure of the mark is
  //    non-fatal — the email already went out.
  await ctx.runMutation(internal.digest.markAdminDigestSent, {});

  return {
    success: true,
    message: "Digest sent successfully",
    recipientEmail: settings.adminEmail,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    newSignups: waitlistSignups.length,
    emailsSent: notificationsSent.reduce((sum, n) => sum + n.count, 0),
    conversions: 0,
    emailId,
  };
}

/**
 * Public action — called by the admin UI "Send Now" button via
 * `useAction(api.digestActions.sendAdminDigestEmail)` from
 * `apps/marketing/components/admin/digest-settings-form.tsx`.
 * Admin-gated via `convex/waitlist.ts:isAdminMarketing`.
 */
export const sendAdminDigestEmail = action({
  args: {
    /**
     * Unique key for this logical "Send Now" invocation. Each UI
     * click generates a fresh `crypto.randomUUID()`; rapid double
     * clicks therefore produce two distinct keys and two emails,
     * matching the user's intent.
     */
    idempotencyKey: v.string(),
  },
  handler: async (ctx, { idempotencyKey }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    // ActionCtx has no `ctx.db`; round-trip through the internal
    // query wrapper for the allowlist-aware admin check.
    if (!(await ctx.runQuery(internal.waitlist.isAdminMarketing, {
      subject: identity.subject,
    }))) {
      throw new Error("Forbidden");
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new ConvexError({
        code: "RESEND_NOT_CONFIGURED",
        message: "RESEND_API_KEY is not set; cannot send digest email",
      });
    }

    const from = resolveFromAddress();
    if (!from) {
      throw new ConvexError({
        code: "RESEND_FROM_NOT_CONFIGURED",
        message:
          "EMAIL_FROM_MARKETING / EMAIL_FROM_TRANSACTIONAL / EMAIL_FROM_STAGING are all unset",
      });
    }

    return await sendDigest(ctx, apiKey, from, idempotencyKey);
  },
});

/**
 * Internal action — called by the Inngest cron via the CONVEX_HTTP_KEY-gated
 * HTTP endpoint `convex/http.ts:httpSendDigest`. No admin gate: the
 * HTTP endpoint is the trust boundary.
 *
 * Enforces cadence BEFORE calling the shared `sendDigest` helper:
 *  - `enabled === false` → skip.
 *  - `frequency === "weekly"` → only Monday (UTC).
 *  - `frequency === "monthly"` → only the 1st of the month (UTC).
 *  - `frequency === "daily"` → every cron tick.
 *
 * The cadence check is intentionally on the Convex side (per
 * `marketing-convex-admin-mirror` plan doc §4f) so manual "Send Now"
 * and scheduled sends share one code path; manual sends bypass this
 * check entirely (they're user-initiated).
 */
export const internalSendScheduledDigest = internalAction({
  args: {
    /**
     * Stable key for this scheduled invocation. The Inngest function
     * passes `digest-${cronTimestamp}`; retries of the same cron tick
     * share the key so Resend dedupes, while distinct cron ticks and
     * any overlapping manual "Send Now" invocations have different
     * keys and deliver as separate emails.
     */
    idempotencyKey: v.string(),
  },
  handler: async (ctx, { idempotencyKey }) => {
    const settings = await ctx.runQuery(
      internal.digest.internalGetAdminDigestSettings,
      {}
    );

    if (!settings.enabled) {
      return { skipped: true, reason: "disabled" };
    }

    const now = new Date();
    const utcDay = now.getUTCDay();
    const utcDate = now.getUTCDate();
    if (settings.frequency === "weekly" && utcDay !== 1) {
      return { skipped: true, reason: "not-weekly" };
    }
    if (settings.frequency === "monthly" && utcDate !== 1) {
      return { skipped: true, reason: "not-monthly" };
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new ConvexError({
        code: "RESEND_NOT_CONFIGURED",
        message: "RESEND_API_KEY is not set; cannot send digest email",
      });
    }

    const from = resolveFromAddress();
    if (!from) {
      throw new ConvexError({
        code: "RESEND_FROM_NOT_CONFIGURED",
        message:
          "EMAIL_FROM_MARKETING / EMAIL_FROM_TRANSACTIONAL / EMAIL_FROM_STAGING are all unset",
      });
    }

    return await sendDigest(ctx, apiKey, from, idempotencyKey);
  },
});
