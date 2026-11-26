/**
 * Parser for Kajabi "new purchase" confirmation emails.
 *
 * The current Kajabi plan does not provide webhooks, so `support@` is a
 * recipient on each offer and Resend receives the confirmation. This parser
 * is deliberately conservative: it extracts only the fields the admin queue
 * needs, and the admin still reviews the raw email before approving.
 *
 * Supported shapes:
 *   - Direct Kajabi confirmation
 *   - Gmail-forwarded confirmation (the original body is preserved after the
 *     `---------- Forwarded message ---------` header)
 */

export type KajabiPurchaseType = "one-on-one" | "group" | "unknown";

export type ParsedKajabiPurchase = {
  offerTitle: string;
  purchaseType: KajabiPurchaseType;
  instructorName?: string;
  studentName?: string;
  studentEmail?: string;
  kajabiPurchaseId?: string;
  kajabiContactId?: string;
};

function firstMatch(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  const value = m?.[1]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function derivePurchaseType(offerTitle: string): KajabiPurchaseType {
  if (/\(1[\s-]?on[\s-]?1\)|\b1:1\b/i.test(offerTitle)) return "one-on-one";
  if (/\bgroup\b/i.test(offerTitle)) return "group";
  return "unknown";
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

export function parseKajabiPurchaseEmail(input: {
  subject: string;
  text?: string | null;
  html?: string | null;
}): ParsedKajabiPurchase | null {
  const subject = input.subject ?? "";
  const body =
    input.text && input.text.trim().length > 0
      ? input.text
      : stripHtml(input.html ?? "");

  // The offer title appears in the subject and in the first body line.
  const offerTitle =
    firstMatch(subject, /new purchase for ['"]([^'"]+)['"]/i) ??
    firstMatch(body, /new purchase for ['"]([^'"]+)['"]/i);

  if (!offerTitle) return null;

  const normalizedTitle = offerTitle.trim();
  const instructorName = normalizedTitle.includes(" - ")
    ? normalizedTitle.split(" - ")[0]?.trim()
    : undefined;

  const studentName = firstMatch(body, /^\s*Name:\s*(.+?)\s*$/im);
  const studentEmail = firstMatch(
    body,
    /^\s*Email:\s*([^\s<>"']+@[^\s<>"']+)/im
  );
  const kajabiPurchaseId = firstMatch(
    body,
    /^\s*Purchase ID:\s*(\d{3,})/im
  );
  // The contact link lives in the `href` of an HTML email, which
  // `stripHtml` removes. Search the raw HTML too.
  const contactSource = input.html ? `${body}\n${input.html}` : body;
  const kajabiContactId = firstMatch(contactSource, /\/contacts\/(\d+)/i);

  return {
    offerTitle: normalizedTitle,
    purchaseType: derivePurchaseType(normalizedTitle),
    instructorName,
    studentName,
    studentEmail,
    kajabiPurchaseId,
    kajabiContactId,
  };
}
