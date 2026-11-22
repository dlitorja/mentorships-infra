type SentReminderRow = {
  kind: "student_invite_48h" | "student_invite_5d";
  studentName: string;
  studentEmail: string;
  onboardingUrl: string;
  sentAt: number;
};

type ReminderSendSummaryArgs = {
  rows: SentReminderRow[];
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function kindLabel(kind: SentReminderRow["kind"]): string {
  return kind === "student_invite_48h" ? "48h invite" : "Final invite (5d)";
}

/**
 * Summary of the onboarding reminders that the worker sent on its own, without
 * an admin approval step. Sent to `ADMIN_EMAILS` once per run that delivers at
 * least one automatic email, so nothing leaves silently.
 */
export function buildReminderSendSummaryEmail(
  args: ReminderSendSummaryArgs
): {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
} {
  const count = args.rows.length;
  const invites48h = args.rows.filter((row) => row.kind === "student_invite_48h")
    .length;
  const invites5d = args.rows.filter((row) => row.kind === "student_invite_5d")
    .length;
  const breakdown = [
    invites48h > 0 ? `${invites48h} × 48h invite` : null,
    invites5d > 0 ? `${invites5d} × final invite` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const subject = `Reminders sent automatically — ${count} student email${
    count === 1 ? "" : "s"
  }`;

  const textLines = [
    `${count} onboarding reminder${count === 1 ? "" : "s"} went out automatically (${breakdown}).`,
    "",
    "These do not require approval. Review the queue in the admin outbox for anything that does.",
    "",
  ];
  for (const row of args.rows) {
    textLines.push(
      `${kindLabel(row.kind)} | ${row.studentName} (${row.studentEmail}) | ${row.onboardingUrl}`
    );
  }

  const rowsHtml = args.rows
    .map(
      (row) =>
        `<tr style="border-bottom:1px solid #F3F4F6">` +
        `<td style="padding:6px 8px">${escapeHtml(kindLabel(row.kind))}</td>` +
        `<td style="padding:6px 8px">${escapeHtml(row.studentName)}<br/><span style="color:#6B7280;font-size:12px">${escapeHtml(row.studentEmail)}</span></td>` +
        `<td style="padding:6px 8px"><a href="${escapeHtml(row.onboardingUrl)}">View</a></td>` +
        `</tr>`
    )
    .join("");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:720px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry — automatic reminders sent</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          <strong>${count}</strong> onboarding reminder${count === 1 ? "" : "s"} went out automatically (${escapeHtml(breakdown)}).
        </div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
          <thead>
            <tr style="border-bottom:1px solid #E5E7EB">
              <th style="text-align:left;padding:6px 8px;color:#6B7280;font-size:12px;font-weight:500">Reminder</th>
              <th style="text-align:left;padding:6px 8px;color:#6B7280;font-size:12px;font-weight:500">Student</th>
              <th style="text-align:left;padding:6px 8px;color:#6B7280;font-size:12px;font-weight:500">Onboarding</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div style="color:#6B7280;font-size:12px">
          These do not require approval. Instructor review nudges and the 7-day admin digest still wait in
          <code>/admin/onboarding-reminders</code>.
        </div>
      </div>
    </div>
  `.trim();

  return {
    subject,
    html,
    text: textLines.join("\n"),
    headers: { "X-Email-Type": "onboarding_reminder_send_summary" },
  };
}
