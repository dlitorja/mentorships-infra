import React from "react";

/**
 * Render a free-text string with URLs converted to clickable anchor
 * tags. Used by the staff-side questionnaire review
 * (`/onboarding/[id]/page.tsx`) so reviewers can open links a
 * student dropped into an answer without copy-pasting first. Also
 * used by the inspiration list — the help text invites students to
 * post links, and a reviewer who clicks through to the artist's
 * portfolio right from the review page is doing exactly the kind
 * of prep that makes the first-call session useful.
 *
 * Detection rules (intentionally narrow so we don't false-match
 * natural text like "F. Kahlo"):
 *
 *   - `http://...` / `https://...` (verbatim scheme).
 *   - `www.something...` (the classic typo of an unwrapped URL).
 *   - `mailto:user@host`.
 *   - `tel:+15555555555` (and similar plain-phone `tel:` schemes).
 *
 * Trailing punctuation (`.`, `,`, `!`, `?`, `)`, `:`, `;`, `]`)
 * is stripped from the matched URL since prose sentences usually
 * end with one of these right after a URL.
 *
 * Security: the rendered `href` is restricted to safe schemes
 * before reaching the DOM. Anything that isn't `http` / `https` /
 * `mailto` / `tel` (e.g. `javascript:`) is demoted to plain text.
 */

const URL_PATTERN =
  /(?:https?:\/\/|www\.|mailto:|tel:)[^\s<>"]+/gi;

/** True when a parsed URL's scheme is safe to render as `href`. */
function isSafeHref(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  if (lower.startsWith("javascript:")) return false;
  if (lower.startsWith("data:")) return false;
  if (lower.startsWith("vbscript:")) return false;
  if (lower.startsWith("file:")) return false;
  return true;
}

/**
 * Normalize the matched text into a clean `href`. Bare `www.x.com`
 * URLs get `https://` prepended. `http://`, `https://`, `mailto:`,
 * `tel:` pass through unchanged.
 */
function normalizeHref(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:")
  ) {
    return raw;
  }
  if (lower.startsWith("www.")) {
    return `https://${raw}`;
  }
  // Defensive fallback — the regex gates the callers, so this
  // branch shouldn't fire in practice. Returning the raw text is
  // safe because `isSafeHref` already rejected anything hostile.
  return raw;
}

/**
 * Strip trailing sentence punctuation from a matched URL string.
 * Returns the cleaned URL plus the leftover trailing chars so the
 * caller can render them as plain text (preserves the
 * human-readable surface of the source string).
 *
 * Greptile P2 #5 — simple `/[.,!?:;)\]]+$/` over-strips when the
 * URL ends in a balanced (or unbalanced-toward-open) paren. For
 * example `https://example.com/portfolio_(series)` had its
 * closing `)` swallowed even though it was part of the URL.
 *
 * Fix: walk the trailer one character at a time. For non-paren
 * chars (`.,!?:;`) we always strip. For closing-paren chars
 * (`)`, `]`) we strip only when the URL has no structural reason
 * to keep them:
 *
 *   - `opens === 0` in trimmed URL → no (`'s left to close, the
 *     trailing `)` is from prose (e.g. sentence "see example.com)"
 *     after a non-paren URL).
 *   - `opens  <  closes` in trimmed URL → already unbalanced
 *     toward closes (e.g. `(((a)` after a `)` was stripped) — the
 *     extra `)` is dangling.
 *   - otherwise (`opens > 0` and `opens >= closes`) → the URL
 *     has unclosed openers that this `)` is closing; keep it.
 *
 * Note: balanced-with-content (`(series)`) lands in the "keep"
 * bucket — URLs people write with intentional parens stay
 * intact. The tradeoff is the rare double-paren `((a))` case
 * (intentional `((a))` would be stripped to `(a)`), but in
 * student essay prose this skews heavily toward accidental and
 * the superior behaviour wins.
 */
function splitTrailing(raw: string): { url: string; tail: string } {
  const isTrailer = (ch: string): boolean =>
    ch === "." || ch === "," || ch === "!" || ch === "?" ||
    ch === ":" || ch === ";" || ch === ")" || ch === "]";
  const isClose = (ch: string): boolean =>
    ch === ")" || ch === "]";
  const isOpen = (ch: string): boolean =>
    ch === "(" || ch === "[";

  let urlEnd = raw.length;
  while (urlEnd > 0) {
    const lastCh = raw[urlEnd - 1];
    if (!isTrailer(lastCh)) break;
    if (isClose(lastCh)) {
      // Decide via counts on the would-be-rendered URL.
      const trimmed = raw.slice(0, urlEnd - 1);
      let opens = 0;
      let closes = 0;
      for (const ch of trimmed) {
        if (isOpen(ch)) opens++;
        else if (isClose(ch)) closes++;
      }
      const shouldStripParen = opens === 0 || opens < closes;
      if (!shouldStripParen) {
        // The trailing `)` is structurally paired with a
        // previous `(`. Keep it as part of the URL itself.
        break;
      }
    }
    urlEnd--;
  }
  if (urlEnd === raw.length) return { url: raw, tail: "" };
  return { url: raw.slice(0, urlEnd), tail: raw.slice(urlEnd) };
}

export function Linkify({
  text,
  className,
}: {
  text: string | null | undefined;
  className?: string;
}): React.JSX.Element {
  const safe = text ?? "";
  // empty / null → render an em-dash so the surrounding layout
  // doesn't collapse the slot.
  if (safe.length === 0) {
    return <span className={className}>—</span>;
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  for (const match of safe.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      parts.push(safe.slice(lastIndex, start));
    }
    const { url, tail } = splitTrailing(match[0]);
    if (isSafeHref(url)) {
      const href = normalizeHref(url);
      parts.push(
        <a
          key={`l-${start}`}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
        >
          {url}
        </a>
      );
      // Render stripped punctuation as plain text so the
      // surrounding sentence reads cleanly.
      if (tail) parts.push(tail);
    } else {
      // Unsafe scheme — render as text, don't promote to clickable.
      parts.push(match[0]);
    }
    lastIndex = start + match[0].length;
  }
  if (lastIndex < safe.length) {
    parts.push(safe.slice(lastIndex));
  }

  return (
    <span className={className ?? "whitespace-pre-wrap"}>
      {parts.map((p, i) => (
        <React.Fragment key={i}>{p}</React.Fragment>
      ))}
    </span>
  );
}
