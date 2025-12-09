import { eq, and, gte, desc, sql, asc, inArray } from "drizzle-orm";
import { db } from "../drizzle";
import { sessions, sessionPacks, mentors, users } from "../../schema";

type Session = typeof sessions.$inferSelect;
type SessionWithMentor = Session & {
  mentor: typeof mentors.$inferSelect;
  mentorUser: typeof users.$inferSelect;
  sessionPack: typeof sessionPacks.$inferSelect;
};

type SessionWithStudent = Session & {
  student: typeof users.$inferSelect;
  sessionPack: typeof sessionPacks.$inferSelect;
};

/**
 * Get user's upcoming sessions (scheduled, not completed/canceled)
 */
export async function getUserUpcomingSessions(
  userId: string,
  limit: number = 10
): Promise<SessionWithMentor[]> {
  const now = new Date();

  const results = await db
    .select({
      session: sessions,
      mentor: mentors,
      mentorUser: users,
      sessionPack: sessionPacks,
    })
    .from(sessions)
    .innerJoin(sessionPacks, eq(sessions.sessionPackId, sessionPacks.id))
    .innerJoin(mentors, eq(sessions.mentorId, mentors.id))
    .innerJoin(users, eq(mentors.userId, users.id))
    .where(
      and(
        eq(sessions.studentId, userId),
        eq(sessions.status, "scheduled"),
        gte(sessions.scheduledAt, now)
      )
    )
    .orderBy(asc(sessions.scheduledAt))
    .limit(limit);

  return results.map((r) => ({
    ...r.session,
    mentor: r.mentor,
    mentorUser: r.mentorUser,
    sessionPack: r.sessionPack,
  }));
}

/**
 * Get user's recent sessions (completed)
 */
export async function getUserRecentSessions(
  userId: string,
  limit: number = 5
): Promise<SessionWithMentor[]> {
  const results = await db
    .select({
      session: sessions,
      mentor: mentors,
      mentorUser: users,
      sessionPack: sessionPacks,
    })
    .from(sessions)
    .innerJoin(sessionPacks, eq(sessions.sessionPackId, sessionPacks.id))
    .innerJoin(mentors, eq(sessions.mentorId, mentors.id))
    .innerJoin(users, eq(mentors.userId, users.id))
    .where(
      and(
        eq(sessions.studentId, userId),
        eq(sessions.status, "completed")
      )
    )
    .orderBy(desc(sessions.completedAt))
    .limit(limit);

  return results.map((r) => ({
    ...r.session,
    mentor: r.mentor,
    mentorUser: r.mentorUser,
    sessionPack: r.sessionPack,
  }));
}

/**
 * Count completed sessions for a session pack
 * This is used to determine session number (1-4) for renewal reminders
 */
export async function getCompletedSessionCount(
  sessionPackId: string
): Promise<number> {
  const result = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.sessionPackId, sessionPackId),
        eq(sessions.status, "completed")
      )
    );

  return Number(result[0]?.count || 0);
}

/**
 * Get session by ID
 */
export async function getSessionById(
  sessionId: string
): Promise<Session | null> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  return session || null;
}

/**
 * Get mentor's upcoming sessions (scheduled, not completed/canceled)
 */
export async function getMentorUpcomingSessions(
  mentorId: string,
  limit: number = 50
): Promise<SessionWithStudent[]> {
  const now = new Date();

  const results = await db
    .select({
      session: sessions,
      student: users,
      sessionPack: sessionPacks,
    })
    .from(sessions)
    .innerJoin(sessionPacks, eq(sessions.sessionPackId, sessionPacks.id))
    .innerJoin(users, eq(sessions.studentId, users.id))
    .where(
      and(
        eq(sessions.mentorId, mentorId),
        eq(sessions.status, "scheduled"),
        gte(sessions.scheduledAt, now)
      )
    )
    .orderBy(asc(sessions.scheduledAt))
    .limit(limit);

  return results.map((r) => ({
    ...r.session,
    student: r.student,
    sessionPack: r.sessionPack,
  }));
}

/**
 * Get mentor's past sessions (completed, canceled, or no_show)
 */
export async function getMentorPastSessions(
  mentorId: string,
  limit: number = 50
): Promise<SessionWithStudent[]> {
  const results = await db
    .select({
      session: sessions,
      student: users,
      sessionPack: sessionPacks,
    })
    .from(sessions)
    .innerJoin(sessionPacks, eq(sessions.sessionPackId, sessionPacks.id))
    .innerJoin(users, eq(sessions.studentId, users.id))
    .where(
      and(
        eq(sessions.mentorId, mentorId),
        inArray(sessions.status, ["completed", "canceled", "no_show"])
      )
    )
    .orderBy(desc(sessions.scheduledAt))
    .limit(limit);

  return results.map((r) => ({
    ...r.session,
    student: r.student,
    sessionPack: r.sessionPack,
  }));
}

/**
 * Get all mentor's sessions (all statuses)
 */
export async function getMentorSessions(
  mentorId: string,
  limit: number = 100
): Promise<SessionWithStudent[]> {
  const results = await db
    .select({
      session: sessions,
      student: users,
      sessionPack: sessionPacks,
    })
    .from(sessions)
    .innerJoin(sessionPacks, eq(sessions.sessionPackId, sessionPacks.id))
    .innerJoin(users, eq(sessions.studentId, users.id))
    .where(eq(sessions.mentorId, mentorId))
    .orderBy(desc(sessions.scheduledAt))
    .limit(limit);

  return results.map((r) => ({
    ...r.session,
    student: r.student,
    sessionPack: r.sessionPack,
  }));
}
