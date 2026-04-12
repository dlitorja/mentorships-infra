// apps/web/lib/db.ts
// Lazy-load DB - getDb() is called at runtime, not build time
import { getDb } from "@mentorships/db";

// This creates a lazy reference - won't be called until actually used
export const db = new Proxy({}, {
  get(_target, prop) {
    return getDb()[prop as keyof ReturnType<typeof getDb>];
  },
});