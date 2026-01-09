function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, "").replace(/[\x00-\x1F\x7F]/g, "");
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface WaitlistSignup {
  instructorName: string;
  mentorshipType: "one-on-one" | "group";
  email: string;
  createdAt: string;
}

interface InventoryStatus {
  instructorName: string;
  oneOnOneInventory: number;
  groupInventory: number;
}

interface NotificationSent {
  instructorName: string;
  mentorshipType: "one-on-one" | "group";
  count: number;
  sentAt: string;
}

interface InventoryChange {
  instructorName: string;
  type: "manual_update" | "kajabi_purchase";
  mentorshipType: "one-on-one" | "group" | null;
  before: number;
  after: number;
  changedAt: string;
}

interface Conversion {
  instructorName: string;
  mentorshipType: "one-on-one" | "group";
  waitlistDuration: number;
  purchasedAt: string;
}

export interface WeeklyDigestData {
  periodStart: string;
  periodEnd: string;
  waitlistSignups: WaitlistSignup[];
  inventoryStatus: InventoryStatus[];
  notificationsSent: NotificationSent[];
  inventoryChanges: InventoryChange[];
  conversions: Conversion[];
}

export function buildWeeklyDigestEmail(data: WeeklyDigestData): {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
} {
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
      (s) => `- ${s.email} joined ${s.instructorName}'s ${s.mentorshipType} waitlist (${formatDate(s.createdAt)})`
    ),
    "",
    "Inventory Changes:",
    ...data.inventoryChanges.map(
      (c) => `- ${c.type}: ${c.instructorName} ${c.mentorshipType || "inventory"} ${c.before} → ${c.after}`
    ),
  ].join("\n");

  const waitlistSignupsHtml = data.waitlistSignups.length > 0
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

  const notificationsHtml = data.notificationsSent.length > 0
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

  const inventoryChangesHtml = data.inventoryChanges.length > 0
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

  const conversionsHtml = data.conversions.length > 0
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

  const inventoryStatusHtml = data.inventoryStatus.length > 0
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
