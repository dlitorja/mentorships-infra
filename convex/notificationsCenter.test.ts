/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const one = { subject: "user_one" };
const two = { subject: "user_two" };

test("create is idempotent on the dedupe key", async () => {
  const t = convexTest(schema, modules);

  const args = {
    userId: "user_one",
    kind: "new_student" as const,
    title: "New student: Sam",
    href: "/instructor/students",
    dedupeKey: "new_student:pack_1:user_one",
  };

  await t.mutation(internal.notificationsCenter.create, args);
  await t.mutation(internal.notificationsCenter.create, args);

  const rows = await t.run(async (ctx) => ctx.db.query("notifications").collect());
  expect(rows).toHaveLength(1);
});

test("only the owner can list and read their notifications", async () => {
  const t = convexTest(schema, modules);

  await t.mutation(internal.notificationsCenter.create, {
    userId: "user_one",
    kind: "renewal_due",
    title: "Time to renew",
    href: "/dashboard",
    dedupeKey: "renewal:pack_1",
  });
  await t.mutation(internal.notificationsCenter.create, {
    userId: "user_two",
    kind: "seat_grace",
    title: "Seat ending",
    dedupeKey: "seat_grace:pack_2",
  });

  const forOne = await t.withIdentity(one).query(
    api.notificationsCenter.listUnreadForUser,
    {}
  );
  expect(forOne).toHaveLength(1);
  expect(forOne[0]?.title).toBe("Time to renew");

  const forTwo = await t.withIdentity(two).query(
    api.notificationsCenter.listUnreadForUser,
    {}
  );
  expect(forTwo).toHaveLength(1);
  expect(forTwo[0]?.title).toBe("Seat ending");

  await expect(
    t.withIdentity(two).mutation(api.notificationsCenter.markRead, {
      notificationId: forOne[0]!._id,
    })
  ).rejects.toThrow(/Forbidden/);
});

test("mark all read clears only the caller's unread rows", async () => {
  const t = convexTest(schema, modules);

  await t.mutation(internal.notificationsCenter.create, {
    userId: "user_one",
    kind: "renewal_due",
    title: "A",
    dedupeKey: "a",
  });
  await t.mutation(internal.notificationsCenter.create, {
    userId: "user_one",
    kind: "seat_grace",
    title: "B",
    dedupeKey: "b",
  });
  await t.mutation(internal.notificationsCenter.create, {
    userId: "user_two",
    kind: "seat_grace",
    title: "C",
    dedupeKey: "c",
  });

  const result = await t.withIdentity(one).mutation(
    api.notificationsCenter.markAllRead,
    {}
  );
  expect(result.updated).toBe(2);

  const oneUnread = await t.withIdentity(one).query(
    api.notificationsCenter.listUnreadForUser,
    {}
  );
  const twoUnread = await t.withIdentity(two).query(
    api.notificationsCenter.listUnreadForUser,
    {}
  );
  expect(oneUnread).toHaveLength(0);
  expect(twoUnread).toHaveLength(1);
});

test("older unread rows stay visible behind read history", async () => {
  const t = convexTest(schema, modules);

  await t.run(async (ctx) => {
    for (let i = 0; i < 8; i += 1) {
      await ctx.db.insert("notifications", {
        userId: "user_one",
        kind: "renewal_due",
        title: `row-${i}`,
        dedupeKey: `row-${i}`,
        read: i > 0,
        readAt: i > 0 ? 1000 : undefined,
        createdAt: i,
      });
    }
  });

  const unread = await t.withIdentity(one).query(
    api.notificationsCenter.listUnreadForUser,
    { limit: 2 }
  );

  expect(unread).toHaveLength(1);
  expect(unread[0]?.title).toBe("row-0");
});

test("the hourly sweep's release path also notifies the student", async () => {
  const t = convexTest(schema, modules);

  let seatId: import("./_generated/dataModel").Id<"seatReservations"> | null = null;
  await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      name: "Sweep Instructor",
      slug: "sweep-instructor",
      email: "sweep@example.com",
      isActive: true,
      isNew: false,
      oneOnOneInventory: 1,
      groupInventory: 0,
    });
    const packId = await ctx.db.insert("sessionPacks", {
      userId: "user_one",
      instructorId,
      totalSessions: 4,
      remainingSessions: 0,
      purchasedAt: Date.now(),
      status: "depleted",
    });
    seatId = await ctx.db.insert("seatReservations", {
      instructorId,
      userId: "user_one",
      sessionPackId: packId,
      seatExpiresAt: Date.now() - 1000,
      status: "grace",
      gracePeriodEndsAt: Date.now() - 1000,
    });
  });

  await t.mutation(internal.seatReservations.releaseSeatById, { seatId: seatId! });

  const unread = await t.withIdentity(one).query(
    api.notificationsCenter.listUnreadForUser,
    {}
  );
  expect(unread).toHaveLength(1);
  expect(unread[0]?.kind).toBe("seat_released");
});
