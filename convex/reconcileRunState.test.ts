/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const NOW = Date.UTC(2026, 8, 6, 12, 0, 0);

test("reconcileRunState.tryStartReconcile: first call acquires lock and stores runId", async () => {
  const t = convexTest(schema, modules);
  const lock = await t.run(async (ctx) => {
    return ctx.runMutation(internal.mutations.reconcileRunState.tryStartReconcile, {
      runStartedAt: NOW,
    });
  });
  expect(lock.acquired).toBe(true);
  if (!lock.acquired) throw new Error("expected acquired");
  expect(typeof lock.runId).toBe("string");
  expect(lock.runId.length).toBeGreaterThan(0);
  expect(lock.currentRunStartedAt).toBe(NOW);
});

test("reconcileRunState.tryStartReconcile: second call within min interval is refused", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.runMutation(internal.mutations.reconcileRunState.tryStartReconcile, {
      runStartedAt: NOW,
    });
  });
  const lock = await t.run(async (ctx) => {
    return ctx.runMutation(internal.mutations.reconcileRunState.tryStartReconcile, {
      runStartedAt: NOW + 5 * 60 * 1000,
    });
  });
  expect(lock.acquired).toBe(false);
  if (lock.acquired) throw new Error("expected not acquired");
  expect(lock.reason).toBe("reconcile_in_progress");
});

test("reconcileRunState.tryStartReconcile: stale in-progress run is recovered after 60 min", async () => {
  const t = convexTest(schema, modules);
  const first = await t.run(async (ctx) => {
    return ctx.runMutation(internal.mutations.reconcileRunState.tryStartReconcile, {
      runStartedAt: NOW,
    });
  });
  expect(first.acquired).toBe(true);

  const recovered = await t.run(async (ctx) => {
    return ctx.runMutation(internal.mutations.reconcileRunState.tryStartReconcile, {
      runStartedAt: NOW + 90 * 60 * 1000,
    });
  });
  expect(recovered.acquired).toBe(true);
  if (!recovered.acquired) throw new Error("expected acquired");
  expect(recovered.staleRecovered).toBe(true);
  expect(recovered.runId).not.toBe(first.runId);
});

test("reconcileRunState.markReconcileCompleted: matching runId clears the lock", async () => {
  const t = convexTest(schema, modules);
  const lock = await t.run(async (ctx) => {
    return ctx.runMutation(internal.mutations.reconcileRunState.tryStartReconcile, {
      runStartedAt: NOW,
    });
  });
  if (!lock.acquired) throw new Error("expected acquired");

  const result = await t.run(async (ctx) => {
    return ctx.runMutation(internal.mutations.reconcileRunState.markReconcileCompleted, {
      completedAt: NOW + 60_000,
      runStartedAt: NOW,
      runId: lock.runId,
    });
  });
  expect(result.cleared).toBe(true);

  const second = await t.run(async (ctx) => {
    return ctx.runMutation(internal.mutations.reconcileRunState.tryStartReconcile, {
      runStartedAt: NOW + 90 * 60 * 1000,
    });
  });
  expect(second.acquired).toBe(true);
});

test("reconcileRunState.markReconcileCompleted: mismatched runId is refused (superseded run can't clear newer lock)", async () => {
  const t = convexTest(schema, modules);
  const lockA = await t.run(async (ctx) => {
    return ctx.runMutation(internal.mutations.reconcileRunState.tryStartReconcile, {
      runStartedAt: NOW,
    });
  });
  if (!lockA.acquired) throw new Error("expected acquired");

  const lockB = await t.run(async (ctx) => {
    return ctx.runMutation(internal.mutations.reconcileRunState.tryStartReconcile, {
      runStartedAt: NOW + 90 * 60 * 1000,
    });
  });
  if (!lockB.acquired) throw new Error("expected acquired");

  const result = await t.run(async (ctx) => {
    return ctx.runMutation(internal.mutations.reconcileRunState.markReconcileCompleted, {
      completedAt: NOW + 120 * 60 * 1000,
      runStartedAt: NOW,
      runId: lockA.runId,
    });
  });
  expect(result.cleared).toBe(false);
  expect(result.reason).toBe("superseded");
});

test("reconcileRunState.isCurrentRun: matches the active run", async () => {
  const t = convexTest(schema, modules);
  const lock = await t.run(async (ctx) => {
    return ctx.runMutation(internal.mutations.reconcileRunState.tryStartReconcile, {
      runStartedAt: NOW,
    });
  });
  if (!lock.acquired) throw new Error("expected acquired");
  const result = await t.query(internal.mutations.reconcileRunState.isCurrentRun, {
    runStartedAt: NOW,
    runId: lock.runId,
  });
  expect(result.current).toBe(true);
});

test("reconcileRunState.isCurrentRun: returns superseded when current run has moved on", async () => {
  const t = convexTest(schema, modules);
  const lockA = await t.run(async (ctx) => {
    return ctx.runMutation(internal.mutations.reconcileRunState.tryStartReconcile, {
      runStartedAt: NOW,
    });
  });
  if (!lockA.acquired) throw new Error("expected acquired");
  await t.run(async (ctx) => {
    return ctx.runMutation(internal.mutations.reconcileRunState.tryStartReconcile, {
      runStartedAt: NOW + 90 * 60 * 1000,
    });
  });
  const result = await t.query(internal.mutations.reconcileRunState.isCurrentRun, {
    runStartedAt: NOW,
    runId: lockA.runId,
  });
  expect(result.current).toBe(false);
  expect(result.reason).toBe("superseded");
});

test("reconcileRunState.isCurrentRun: returns id_mismatch for wrong runId with matching runStartedAt", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    return ctx.runMutation(internal.mutations.reconcileRunState.tryStartReconcile, {
      runStartedAt: NOW,
    });
  });
  const result = await t.query(internal.mutations.reconcileRunState.isCurrentRun, {
    runStartedAt: NOW,
    runId: "wrong-run-id",
  });
  expect(result.current).toBe(false);
  expect(result.reason).toBe("id_mismatch");
});
