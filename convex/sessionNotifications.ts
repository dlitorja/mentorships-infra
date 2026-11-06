import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

/**
 * Data source for the `send-session-reminders` Trigger task.
 *
 * Replaces the Drizzle/Postgres query against Supabase. Sessions, users and
 * instructors all live in Convex, so the task no longer needs the paused
 * Supabase project at all.
 *
 * Served over `GET /session-notifications/reminder-window` (Bearer
 * CONVEX_HTTP_KEY) so the Trigger worker can page through it the same way
 * the retention and reconciliation jobs do.
 */

export type ReminderRow = {
  sessionId: string;
  scheduledAt: number;
  studentEmail: string;
  studentTimeZone: string | null;
  instructorName: string;
  instructorEmail: string | null;
  instructorTimeZone: string | null;
};

export const getReminderWindow = internalQuery({
  args: {
    startMs: v.number(),
    endMs: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    // `by_scheduledAt` is the selective index for a 15-minute window; the
    // status filter is applied per row (a handful of rows per window).
    const page = await ctx.db
      .query("sessions")
      .withIndex("by_scheduledAt", (q) =>
        q.gte("scheduledAt", args.startMs).lt("scheduledAt", args.endMs)
      )
      .paginate(args.paginationOpts);

    // Per-page caches: the same student or instructor can appear in several
    // sessions, and this keeps the read count proportional to distinct
    // people rather than to rows.
    const usersByClerkId = new Map<
      string,
      { email?: string; timeZone?: string } | null
    >();

    // `session.studentId` is a Clerk id, but a split record can hold a
    // different `users.userId` for the same person (adminOnboardings
    // `isSeparateStudentRecord`). Match by `userId` first, then fall back to
    // `clerkId` — otherwise those sessions silently lose their reminder.
    const findUser = async (id: string) => {
      if (usersByClerkId.has(id)) return usersByClerkId.get(id) ?? null;
      const byUserId = await ctx.db
        .query("users")
        .withIndex("by_userId", (q) => q.eq("userId", id))
        .first();
      const doc =
        byUserId ??
        (await ctx.db
          .query("users")
          .withIndex("by_clerkId", (q) => q.eq("clerkId", id))
          .first());
      const value = doc ? { email: doc.email, timeZone: doc.timeZone } : null;
      usersByClerkId.set(id, value);
      return value;
    };
    const instructorsById = new Map<
      string,
      { name?: string; userId?: string } | null
    >();

    const rows: ReminderRow[] = [];

    for (const session of page.page) {
      if (session.status !== "scheduled") continue;
      if (session.deletedAt !== undefined) continue;

      let instructor = instructorsById.get(session.instructorId);
      if (instructor === undefined) {
        const doc = await ctx.db.get(session.instructorId);
        instructor = doc ? { name: doc.name, userId: doc.userId } : null;
        instructorsById.set(session.instructorId, instructor);
      }
      // The Postgres query inner-joined `instructors`, so a session with a
      // dangling instructor reference was never reminded. Preserve that.
      if (!instructor) continue;

      const student = await findUser(session.studentId);
      // Same for `users`: the inner join dropped sessions without a student
      // row, and a row without an email produced no student reminder.
      if (!student) continue;

      const instructorUser = instructor.userId
        ? await findUser(instructor.userId)
        : null;

      rows.push({
        sessionId: session._id,
        scheduledAt: session.scheduledAt,
        studentEmail: student.email ?? "",
        studentTimeZone: student.timeZone ?? null,
        instructorName: instructor.name ?? "",
        instructorEmail: instructorUser?.email ?? null,
        instructorTimeZone: instructorUser?.timeZone ?? null,
      });
    }

    return {
      rows,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
