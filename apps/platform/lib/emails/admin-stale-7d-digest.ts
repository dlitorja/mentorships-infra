type StaleRow = {
  studentName: string;
  studentEmail: string;
  instructorName: string;
  daysPending: number;
  onboardingUrl: string;
};

type AdminStale7dDigestArgs = {
  rows: StaleRow[];
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildAdminStale7dDigestEmail(
  args: AdminStale7dDigestArgs
): {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
} {
  const count = args.rows.length;
  const subject = `[Admin] 7-day check-in — ${count} student${
    count === 1 ? "" : "s"
  } haven't signed up`;

  const textLines = [
    `${count} student${count === 1 ? "" : "s"} have not created their account 7 days after onboarding:`,
    "",
  ];
  for (const row of args.rows) {
    textLines.push(
      `${row.studentName} (${row.studentEmail}) | ${row.instructorName} | ${row.daysPending} days | ${row.onboardingUrl}`
    );
  }
  textLines.push(
    "",
    "The 13-day stale digest will release their placeholder seat if they still have not signed up. Reach out manually if you want to keep the seat."
  );

  const rowsHtml = args.rows
    .map(
      (row) =>
        `<tr style="border-bottom:1px solid #F3F4F6">` +
        `<td style="padding:6px 8px">${escapeHtml(row.studentName)}<br/><span style="color:#6B7280;font-size:12px">${escapeHtml(row.studentEmail)}</span></td>` +
        `<td style="padding:6px 8px">${escapeHtml(row.instructorName)}</td>` +
        `<td style="padding:6px 8px">${row.daysPending}</td>` +
        `<td style="padding:6px 8px"><a href="${escapeHtml(row.onboardingUrl)}">View</a></td>` +
        `</tr>`
    )
    .join("");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:720px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry — 7-day onboarding check-in</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          <strong>${count}</strong> student${count === 1 ? "" : "s"} have not created their account 7 days after onboarding.
        </div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
          <thead>
            <tr style="border-bottom:1px solid #E5E7EB">
              <th style="text-align:left;padding:6px 8px;color:#6B7280;font-size:12px;font-weight:500">Student</th>
              <th style="text-align:left;padding:6px 8px;color:#6B7280;font-size:12px;font-weight:500">Instructor</th>
              <th style="text-align:left;padding:6px 8px;color:#6B7280;font-size:12px;font-weight:500">Days</th>
              <th style="text-align:left;padding:6px 8px;color:#6B7280;font-size:12px;font-weight:500">Onboarding</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div style="color:#6B7280;font-size:12px">
          The 13-day stale digest will release their placeholder seat if they still have not signed up. Reach out manually if you want to keep the seat.
        </div>
      </div>
    </div>
  `.trim();

  return {
    subject,
    html,
    text: textLines.join("\n"),
    headers: { "X-Email-Type": "admin_stale_onboarding_7d_digest" },
  };
}
