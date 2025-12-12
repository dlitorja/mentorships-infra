import { and, asc, eq, lt, or } from "drizzle-orm";
import { db } from "../drizzle";
import { discordActionQueue } from "../../schema/discordActionQueue";
import type { DiscordActionStatus } from "../../schema/discordActionQueue";

export type DiscordAction = typeof discordActionQueue.$inferSelect;

export async function getDiscordActionById(id: string): Promise<DiscordAction | null> {
  const [row] = await db.select().from(discordActionQueue).where(eq(discordActionQueue.id, id)).limit(1);
  return row ?? null;
}

/**
 * Claim pending Discord actions for processing.
 *
 * This is intentionally simple and safe for a future bot process:
 * - actions in `pending` are eligible
 * - actions in `processing` become eligible again if `lockedAt` is older than `lockTtlMs`
 */
export async function claimDiscordActions(args?: {
  limit?: number;
  lockTtlMs?: number;
}): Promise<DiscordAction[]> {
  const limit = args?.limit ?? 25;
  const lockTtlMs = args?.lockTtlMs ?? 10 * 60 * 1000;

  const now = new Date();
  const staleBefore = new Date(now.getTime() - lockTtlMs);

  const candidates = await db
    .select()
    .from(discordActionQueue)
    .where(
      or(
        eq(discordActionQueue.status, "pending"),
        and(eq(discordActionQueue.status, "processing"), lt(discordActionQueue.lockedAt, staleBefore))
      )
    )
    .orderBy(asc(discordActionQueue.createdAt))
    .limit(limit);

  const claimed: DiscordAction[] = [];

  for (const c of candidates) {
    const [updated] = await db
      .update(discordActionQueue)
      .set({ status: "processing", lockedAt: now, updatedAt: now })
      .where(eq(discordActionQueue.id, c.id))
      .returning();

    if (updated) claimed.push(updated);
  }

  return claimed;
}

export async function setDiscordActionStatus(args: {
  id: string;
  status: DiscordActionStatus;
  lastError?: string | null;
  lockedAt?: Date | null;
  attempts?: number;
}): Promise<DiscordAction> {
  const now = new Date();
  const [updated] = await db
    .update(discordActionQueue)
    .set({
      status: args.status,
      lastError: args.lastError ?? null,
      lockedAt: args.lockedAt ?? null,
      attempts: args.attempts,
      updatedAt: now,
    })
    .where(eq(discordActionQueue.id, args.id))
    .returning();

  if (!updated) {
    throw new Error(`Discord action ${args.id} not found`);
  }

  return updated;
}

export async function markDiscordActionDone(id: string): Promise<DiscordAction> {
  return await setDiscordActionStatus({ id, status: "done", lastError: null, lockedAt: null });
}

export async function markDiscordActionFailed(args: { id: string; error: string }): Promise<DiscordAction> {
  const existing = await getDiscordActionById(args.id);
  const attempts = (existing?.attempts ?? 0) + 1;
  return await setDiscordActionStatus({
    id: args.id,
    status: "failed",
    lastError: args.error.slice(0, 2000),
    lockedAt: null,
    attempts,
  });
}


