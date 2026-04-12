// apps/web/lib/db.ts
// Lazy-load DB - getDb() is called at runtime, not build time
import { getDb } from "@mentorships/db";

// This creates a lazy reference - won't be called until actually used
export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop) {
    const database = getDb();
    return (database as any)[prop];
  },
});