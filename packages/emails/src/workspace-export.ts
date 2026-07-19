function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatExpiry(timestamp: number): string {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

/**
 * Builds the "your workspace export is ready" email.
 *
 * Mirrors the patterns in `ad-hoc-call.ts` so the export flow
 * notifies the user even when they have navigated away from the
 * workspace UI (the only place the in-app toast currently fires).
 *
 * @param args.workspaceName - Display name of the workspace exported
 * @param args.downloadUrl - Signed B2 download URL (typically 7-day expiry)
 * @param args.expiresAt - Unix timestamp when the signed URL stops working
 * @returns Email payload with subject, text, HTML, and X-Email-Type header
 */
export function buildWorkspaceExportReadyEmail(args: {
  workspaceName: string;
  downloadUrl: string;
  expiresAt: number;
}) {
  const subject = `Your ${args.workspaceName} export is ready`;
  const expiryLabel = formatExpiry(args.expiresAt);

  const text = [
    `Your workspace export for ${args.workspaceName} is ready.`,
    "",
    "Click below to download:",
    args.downloadUrl,
    "",
    `This download link expires on ${expiryLabel}. After that, please re-run the export from the workspace's Images tab.`,
    "",
    "If the link does not work, sign in to your Huckleberry Mentorships account and open the workspace from your dashboard.",
  ].join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px">Workspace export ready</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          Your export for <strong>${escapeHtml(args.workspaceName)}</strong> is ready to download.
        </div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          Click the button below to download the ZIP file.
        </div>
        <a href="${escapeHtml(args.downloadUrl)}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Download export</a>
        <p style="margin:16px 0 0 0;color:#6B7280;font-size:12px">
          This download link expires on ${escapeHtml(expiryLabel)}. After that, re-run the export from the workspace's Images tab.
        </p>
        <p style="margin:12px 0 0 0;color:#6B7280;font-size:12px">
          If the button does not work, copy/paste this link:<br/>
          <span>${escapeHtml(args.downloadUrl)}</span>
        </p>
      </div>
    </div>
  `.trim();

  return {
    subject,
    text,
    html,
    headers: { "X-Email-Type": "workspace_export_ready" },
  };
}
