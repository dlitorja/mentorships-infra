import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `ctx.runQuery` / `ctx.runMutation` / `ctx.runAction` accept only a generated
 * function reference (`api.module.fn` or `internal.module.fn`). Passing a
 * direct module import (e.g. `ctx.runMutation(decrementInventory as any)`)
 * typechecks behind the cast but throws at runtime ("is not a
 * functionReference") in the real Convex runtime.
 *
 * `convex-test` replaces the action `runQuery`/`runMutation` handlers with
 * direct-function calls, so the Convex test suite cannot catch this — hence a
 * static check. A direct import *without* `as any` is already a type error.
 *
 * Regression: `/instructors/google-credentials` (PR #962) and the
 * `/inventory/*` handlers (fixed in #975) both fell into this trap.
 */

// Vitest runs from the repo root; `import.meta.url` is an http:// URL under
// the jsdom environment, so resolve from cwd instead.
const HTTP_SOURCE = resolve(process.cwd(), "convex/http.ts");

const DIRECT_IMPORT_CALL =
  /ctx\.run(?:Query|Mutation|Action)\(\s*([A-Za-z_$][\w$]*)\s+as\s+any/g;

describe("convex/http.ts function references", () => {
  it("does not pass direct module imports to ctx.run*", () => {
    const source = readFileSync(HTTP_SOURCE, "utf8");
    const offenders = [...source.matchAll(DIRECT_IMPORT_CALL)].map((match) => match[1]);

    expect(
      offenders,
      "Use api.<module>.<fn> or internal.<module>.<fn> instead of a direct import.",
    ).toEqual([]);
  });
});
