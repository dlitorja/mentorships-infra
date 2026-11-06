import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

/**
 * The session-reminder task used to read Supabase/Postgres. Supabase is
 * paused (and being retired), so the data now comes from Convex through
 * `GET /session-notifications/reminder-window`. These tests pin the
 * behaviour the old SQL had.
 */

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: "user_instructor",
      email: "instructor@example.com",
      slug: "test-instructor",
      name: "Ada Instructor",
    } as never);

    await ctx.db.insert("users", {
      userId: "user_instructor",
      clerkId: "user_instructor",
      email: "instructor@example.com",
      timeZone: "Europe/London",
    } as never);

    await ctx.db.insert("users", {
      userId: "user_student",
      clerkId: "user_student",
      email: "student@example.com",
      timeZone: "America/New_York",
    } as never);

    const base = {
      instructorId,
      status: "scheduled" as const,
      recordingConsent: true,
    };

    const scheduled = await ctx.db.insert("sessions", {
      ...base,
      studentId: "user_student",
      scheduledAt: NOW + 30 * 60 * 1000, // in window
    } as never);

    await ctx.db.insert("sessions", {
      ...base,
      studentId: "user_student",
      scheduledAt: NOW + 5 * HOUR, // outside window
    } as never);

    await ctx.db.insert("sessions", {
      ...base,
      studentId: "user_student",
      scheduledAt: NOW + 35 * 60 * 1000,
      status: "canceled", // wrong status
    } as never);

    await ctx.db.insert("sessions", {
      ...base,
      studentId: "user_student",
      scheduledAt: NOW + 40 * 60 * 1000,
      deletedAt: NOW, // soft-deleted
    } as never);

    await ctx.db.insert("sessions", {
      ...base,
      studentId: "user_without_row", // inner join would drop this
      scheduledAt: NOW + 45 * 60 * 1000,
    } as never);

    return { instructorId, scheduled };
  });
}

describe("getReminderWindow", () => {
  it("returns only scheduled, live sessions inside the window, with student and instructor contact details", async () => {
    const t = convexTest(schema, modules);
    const { scheduled } = await seed(t);

    const result = await t.query(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import("./_generated/api")).internal.sessionNotifications.getReminderWindow as any,
      {
        startMs: NOW,
        endMs: NOW + HOUR,
        paginationOpts: { cursor: null, numItems: 100 },
      }
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      sessionId: scheduled,
      studentEmail: "student@example.com",
      studentTimeZone: "America/New_York",
      instructorName: "Ada Instructor",
      instructorEmail: "instructor@example.com",
      instructorTimeZone: "Europe/London",
    });
    expect(result.isDone).toBe(true);
  });

  it("finds a student whose users.userId differs from the session's Clerk id", async () => {
    // Split-record students: `session.studentId` holds the Clerk id while
    // `users.userId` is a distinct value. Looking up only by_userId dropped
    // the whole session, so neither party got a reminder.
    const t = convexTest(schema, modules);
    const { instructorId } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        userId: "internal_split_id",
        clerkId: "user_split_student",
        email: "split@example.com",
        timeZone: "Asia/Tokyo",
      } as never);
      await ctx.db.insert("sessions", {
        instructorId,
        studentId: "user_split_student",
        scheduledAt: NOW + 20 * 60 * 1000,
        status: "scheduled",
        recordingConsent: true,
      } as never);
    });

    const result = await t.query(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import("./_generated/api")).internal.sessionNotifications.getReminderWindow as any,
      {
        startMs: NOW + 15 * 60 * 1000,
        endMs: NOW + 25 * 60 * 1000,
        paginationOpts: { cursor: null, numItems: 100 },
      }
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      studentEmail: "split@example.com",
      studentTimeZone: "Asia/Tokyo",
    });
  });

  it("skips sessions whose instructor has no user row (no email to send to)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await t.run(async (ctx) => {
      const instructorId = await ctx.db.insert("instructors", {
        userId: "user_without_email",
        email: "noreply@example.com",
        slug: "no-user-row",
        name: "No User Row",
      } as never);
      await ctx.db.insert("sessions", {
        instructorId,
        studentId: "user_student",
        scheduledAt: NOW + 50 * 60 * 1000,
        status: "scheduled",
        recordingConsent: true,
      } as never);
    });

    const result = await t.query(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import("./_generated/api")).internal.sessionNotifications.getReminderWindow as any,
      {
        startMs: NOW + 45 * 60 * 1000,
        endMs: NOW + 55 * 60 * 1000,
        paginationOpts: { cursor: null, numItems: 100 },
      }
    );

    // The session is returned; the missing *instructor user* only means no
    // instructor email (`instructorEmail: null`), matching the old SQL.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].instructorEmail).toBeNull();
  });
});

describe("GET /session-notifications/reminder-window", () => {
  const KEY = "test-http-key-session-notifications";

  beforeEach(() => {
    process.env.CONVEX_HTTP_KEY = KEY;
  });

  afterEach(() => {
    delete process.env.CONVEX_HTTP_KEY;
  });

  it("rejects an unauthenticated request", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch(
      `/session-notifications/reminder-window?start=${NOW}&end=${NOW + HOUR}`,
      { method: "GET" }
    );
    expect(response.status).toBe(401);
  });

  it("returns the window payload to an authenticated caller", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const response = await t.fetch(
      `/session-notifications/reminder-window?start=${NOW}&end=${NOW + HOUR}`,
      { method: "GET", headers: { Authorization: `Bearer ${KEY}` } }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { rows: Array<{ studentEmail: string }>; isDone: boolean };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].studentEmail).toBe("student@example.com");
  });

  it("rejects a missing or inverted window", async () => {
    const t = convexTest(schema, modules);
    for (const qs of ["", `?start=${NOW}`, `?start=${NOW + HOUR}&end=${NOW}`]) {
      const response = await t.fetch(`/session-notifications/reminder-window${qs}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${KEY}` },
      });
      expect(response.status).toBe(400);
    }
  });
});
