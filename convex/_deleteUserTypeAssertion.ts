// Compile-time assertion: `convex/users.ts:deleteUser` must remain an
// `internalMutation` so that the public attack surface documented in
// PR #919 stays closed. This file is NOT a `.test.ts` so it is included
// in `convex/tsconfig.json` type-checking (which excludes `*.test.ts`).
//
// Behavior:
//   - deleteUser is `internalMutation`  →  file compiles cleanly.
//   - deleteUser is reverted to `mutation` (public)  →  `tsc` reports
//     TS2578 "Unused '@ts-expect-error' directive" because the
//     suppression no longer matches an error.
//
// Either way, CI's `pnpm typecheck` catches the regression.

import { api, internal } from "./_generated/api";

// Positive: deleteUser IS reachable via the internal surface.
// If a future PR removes `deleteUser` entirely, this fails to compile
// because `typeof internal.users.deleteUser` becomes `undefined`.
const _deleteUserInternalRef: typeof internal.users.deleteUser =
  internal.users.deleteUser;
void _deleteUserInternalRef;

// Negative: deleteUser MUST NOT be reachable via the public surface.
// `FilterApi<..., FunctionReference<any, "public">>` resolves to
// `never` when the function is internal-only, so `api.users.deleteUser`
// fails with TS2339 ("property does not exist") and `@ts-expect-error`
// consumes that error. If a future PR leaks deleteUser to public, the
// access no longer errors and TypeScript reports an unused directive.
// @ts-expect-error -- deleteUser MUST NOT exist on the public api.
const _deleteUserIsNotPublic = api.users.deleteUser;
void _deleteUserIsNotPublic;
