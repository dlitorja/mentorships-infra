/**
 * Export helpers shared by the Trigger.dev export tasks.
 *
 * Kept in `@mentorships/storage` (next to `zip.ts` and
 * `bulk-download-jobs.ts`) so the pure formatting logic is unit-testable
 * without a Trigger.dev runtime, a B2 bucket, or a Convex deployment.
 */

/**
 * RFC 4180 cell escaping, plus spreadsheet formula-injection defence.
 *
 * Titles and URLs in a workspace are user-supplied. Excel / Sheets
 * execute a cell that starts with `=`, `+`, `-`, or `@`, so a link
 * titled `=HYPERLINK("http://evil","click")` would run when a reviewer
 * opens the CSV. Prefixing with a single quote keeps the value readable
 * while forcing the cell to be treated as text (OWASP CSV-injection
 * guidance).
 */
export function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  let text = String(value);

  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export interface LinkCsvRow {
  url: string;
  title?: string;
  /**
   * Human display name of the person who added the link (instructor
   * profile name for instructors, first + last name otherwise). Clerk
   * ids and email addresses are deliberately not accepted here.
   */
  addedByName: string;
  sessionId?: string;
  createdAt: number;
}

/**
 * Serialises the Links tab into CSV.
 *
 * A BOM is prepended so Excel opens the file as UTF-8 instead of
 * mangling non-ASCII titles. `\r\n` line endings per RFC 4180.
 */
export function generateLinksCsv(links: LinkCsvRow[]): string {
  const header = ["title", "url", "added_by", "added_at", "shared_in_call"];
  const rows = links.map((link) => [
    csvCell(link.title ?? ""),
    csvCell(link.url),
    csvCell(link.addedByName),
    csvCell(new Date(link.createdAt).toISOString()),
    csvCell(link.sessionId ? "yes" : "no"),
  ]);

  const body = [header, ...rows].map((row) => row.join(",")).join("\r\n");
  return `\uFEFF${body}\r\n`;
}

/**
 * Returns a filename unique within `used`.
 *
 * Two uploads named `sketch.png` would otherwise collapse into one ZIP
 * entry (archiver overwrites by name), so the second becomes
 * `sketch-2.png`.
 */
export function uniqueArchiveName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }

  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";

  let index = 2;
  let candidate = `${stem}-${index}${ext}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${stem}-${index}${ext}`;
  }
  used.add(candidate);
  return candidate;
}
