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

// Trailing characters that almost always belong to the surrounding
// sentence, not to the URL itself.
const TRAILING_PUNCT = /[.,!?:;)\]]+$/;

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
 */
function splitTrailing(raw: string): { url: string; tail: string } {
  const m = raw.match(TRAILING_PUNCT);
  if (!m) return { url: raw, tail: "" };
  const cut = raw.length - m[0].length;
  return { url: raw.slice(0, cut), tail: raw.slice(cut) };
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
