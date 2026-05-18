import { eq, and, gte, desc, sql, asc, inArray } from "drizzle-orm";
import { db } from "../drizzle";
import { sessions, sessionPacks, instructorIntegrations, users, instructors } from "../../schema";

type Session = typeof sessions.$inferSelect;
type SessionWithInstructor = Session & {
  instructorIntegration: typeof instructorIntegrations.$inferSelect;
  instructorUser: typeof users.$inferSelect;
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
): Promise<SessionWithInstructor[]> {
  const now = new Date();

  const results = await db
    .select({
      session: sessions,
      instructorIntegration: instructorIntegrations,
      instructorUser: users,
      sessionPack: sessionPacks,
    })
    .from(sessions)
    .innerJoin(sessionPacks, eq(sessions.sessionPackId, sessionPacks.id))
    .innerJoin(instructors, eq(sessions.instructorId, instructors.id))
    .innerJoin(instructorIntegrations, eq(instructors.userId, instructorIntegrations.userId))
    .innerJoin(users, eq(instructors.userId, users.id))
    .where(
      and(
        eq(sessions.studentId, userId),
        eq(sessions.status, "scheduled"),
        gte(sessions.scheduledAt, now)
      )
    )
    .orderBy(asc(sessions.scheduledAt))
    .limit(limit);

  return results.map((r: typeof results[number]) => ({
    ...r.session,
    instructorIntegration: r.instructorIntegration,
    instructorUser: r.instructorUser,
    sessionPack: r.sessionPack,
  }));
}

/**
 * Get user's recent sessions (completed)
 */
export async function getUserRecentSessions(
  userId: string,
  limit: number = 5
): Promise<SessionWithInstructor[]> {
  const results = await db
    .select({
      session: sessions,
      instructorIntegration: instructorIntegrations,
      instructorUser: users,
      sessionPack: sessionPacks,
    })
    .from(sessions)
    .innerJoin(sessionPacks, eq(sessions.sessionPackId, sessionPacks.id))
    .innerJoin(instructors, eq(sessions.instructorId, instructors.id))
    .innerJoin(instructorIntegrations, eq(instructors.userId, instructorIntegrations.userId))
    .innerJoin(users, eq(instructors.userId, users.id))
    .where(
      and(
        eq(sessions.studentId, userId),
        eq(sessions.status, "completed")
      )
    )
    .orderBy(desc(sessions.completedAt))
    .limit(limit);

  return results.map((r: typeof results[number]) => ({
    ...r.session,
    instructorIntegration: r.instructorIntegration,
    instructorUser: r.instructorUser,
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
 * Get instructor's upcoming sessions (scheduled, not completed/canceled)
 */
export async function getInstructorUpcomingSessions(
  instructorId: string,
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
        eq(sessions.instructorId, instructorId),
        eq(sessions.status, "scheduled"),
        gte(sessions.scheduledAt, now)
      )
    )
    .orderBy(asc(sessions.scheduledAt))
    .limit(limit);

  return results.map((r: typeof results[number]) => ({
    ...r.session,
    student: r.student,
    sessionPack: r.sessionPack,
  }));
}

/**
 * Get instructor's past sessions (completed, canceled, or no_show)
 */
export async function getInstructorPastSessions(
  instructorId: string,
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
        eq(sessions.instructorId, instructorId),
        inArray(sessions.status, ["completed", "canceled", "no_show"])
      )
    )
    .orderBy(desc(sessions.scheduledAt))
    .limit(limit);

  return results.map((r: typeof results[number]) => ({
    ...r.session,
    student: r.student,
    sessionPack: r.sessionPack,
  }));
}

/**
 * Get all instructor's sessions (all statuses)
 */
export async function getInstructorSessions(
  instructorId: string,
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
    .where(eq(sessions.instructorId, instructorId))
    .orderBy(desc(sessions.scheduledAt))
    .limit(limit);

  return results.map((r: typeof results[number]) => ({
    ...r.session,
    student: r.student,
    sessionPack: r.sessionPack,
  }));
}
