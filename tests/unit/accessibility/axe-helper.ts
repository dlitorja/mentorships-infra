import { run } from "axe-core";
import type { RunOptions, AxeResults } from "axe-core";

const defaultOptions: RunOptions = {
  resultTypes: ["violations", "incomplete"],
  rules: {
    // Color contrast needs real browser rendering; flag incomplete but don't hard-fail in jsdom.
    "color-contrast": { enabled: false },
  },
};

/**
 * Scans the provided DOM element for accessibility violations and returns axe
 * results. Designed for use in Vitest/jsdom tests with `@testing-library/react`.
 *
 * @param element - The element to scan (typically `document.body` or a rendered container).
 * @param options - Optional axe-core run options.
 * @returns The axe-core results object.
 */
export async function scanAccessibility(
  element: Element = document.body,
  options: RunOptions = {}
): Promise<AxeResults> {
  return run(element, { ...defaultOptions, ...options });
}

/**
 * Asserts that an axe-core scan contains no critical or serious violations.
 * Throws a formatted error listing any violations found.
 *
 * @param results - The results returned by `scanAccessibility`.
 * @param includedRules - Optional rule ids to restrict the assertion to.
 */
export function expectNoCriticalOrSeriousViolations(
  results: AxeResults,
  includedRules?: string[]
): void {
  const violations = results.violations.filter(
    (v) =>
      (v.impact === "critical" || v.impact === "serious") &&
      (!includedRules || includedRules.includes(v.id))
  );

  if (violations.length === 0) {
    return;
  }

  const summary = violations
    .map(
      (v) =>
        `  [${v.impact}] ${v.id}: ${v.help}\n` +
        `    ${v.helpUrl}\n` +
        v.nodes
          .map(
            (n) =>
              `      - ${n.target.join(", ")}${n.html ? `\n        ${n.html}` : ""}`
          )
          .join("\n")
    )
    .join("\n\n");

  throw new Error(
    `Accessibility violations found (${violations.length}):\n\n${summary}`
  );
}
