import { eq, desc, sql, and, gte, ilike, or, isNull, aliasedTable } from "drizzle-orm";
import { db } from "../drizzle";
import { mentors, users, sessionPacks, sessions, seatReservations } from "../../schema";
import type { SessionPackStatus } from "../../schema/sessionPacks";

const instructorUsers = aliasedTable(users, "instructor_users");

export type InstructorWithStats = {
  mentorId: string;
  userId: string;
  email: string;
  bio: string | null;
  oneOnOneInventory: number;
  groupInventory: number;
  maxActiveStudents: number;
  activeMenteeCount: number;
  totalCompletedSessions: number;
  createdAt: Date;
};

export type MenteeWithSessionInfo = {
  userId: string;
  email: string;
  sessionPackId: string;
  totalSessions: number;
  remainingSessions: number;
  status: SessionPackStatus;
  expiresAt: Date;
  lastSessionCompletedAt: Date | null;
  completedSessionCount: number;
  seatStatus: "active" | "grace" | "released";
  seatExpiresAt: Date | null;
};

export type InstructorWithMentees = InstructorWithStats & {
  mentees: MenteeWithSessionInfo[];
};

export async function getAllInstructorsWithStats(
  search?: string,
  page: number = 1,
  pageSize: number = 50
): Promise<{ instructors: InstructorWithStats[]; total: number }> {
  const offset = (page - 1) * pageSize;

  if (search && search.trim()) {
    const searchTerm = `%${search.trim()}%`;
    const searchCondition = or(
      ilike(users.email, searchTerm)
    );

    return await db.transaction(async (tx) => {
      const totalResult = await tx
        .select({ count: sql<number>`count(*)` })
        .from(mentors)
        .innerJoin(users, eq(mentors.userId, users.id))
        .where(and(isNull(mentors.deletedAt), searchCondition));

      const total = Number(totalResult[0]?.count || 0);

      const results = await tx
        .select({
          mentorId: mentors.id,
          userId: users.id,
          email: users.email,
          bio: mentors.bio,
          oneOnOneInventory: mentors.oneOnOneInventory,
          groupInventory: mentors.groupInventory,
          maxActiveStudents: mentors.maxActiveStudents,
          createdAt: mentors.createdAt,
          activeMenteeCount: sql<number>`COUNT(DISTINCT ${seatReservations.id})`,
          totalCompletedSessions: sql<number>`COALESCE(SUM(CASE WHEN ${sessions.status} = 'completed' THEN 1 ELSE 0 END), 0)::int`,
        })
        .from(mentors)
        .innerJoin(users, eq(mentors.userId, users.id))
        .leftJoin(seatReservations, and(eq(seatReservations.mentorId, mentors.id), eq(seatReservations.status, "active")))
        .leftJoin(sessionPacks, and(eq(sessionPacks.mentorId, mentors.id), eq(sessionPacks.id, seatReservations.sessionPackId)))
        .leftJoin(sessions, and(eq(sessions.sessionPackId, sessionPacks.id), eq(sessions.status, "completed")))
        .where(and(isNull(mentors.deletedAt), searchCondition))
        .groupBy(mentors.id, users.id, users.email, mentors.bio, mentors.oneOnOneInventory, mentors.groupInventory, mentors.maxActiveStudents, mentors.createdAt)
        .orderBy(desc(mentors.createdAt))
        .limit(pageSize)
        .offset(offset);

      return {
        instructors: results.map((r) => ({
          mentorId: r.mentorId,
          userId: r.userId,
          email: r.email,
          bio: r.bio,
          oneOnOneInventory: r.oneOnOneInventory,
          groupInventory: r.groupInventory,
          maxActiveStudents: r.maxActiveStudents,
          activeMenteeCount: Number(r.activeMenteeCount) || 0,
          totalCompletedSessions: r.totalCompletedSessions,
          createdAt: r.createdAt,
        })),
        total,
      };
    });
  }

  return await db.transaction(async (tx) => {
    const totalResult = await tx
      .select({ count: sql<number>`count(*)` })
      .from(mentors)
      .innerJoin(users, eq(mentors.userId, users.id))
      .where(isNull(mentors.deletedAt));

    const total = Number(totalResult[0]?.count || 0);

    const results = await tx
      .select({
        mentorId: mentors.id,
        userId: users.id,
        email: users.email,
        bio: mentors.bio,
        oneOnOneInventory: mentors.oneOnOneInventory,
        groupInventory: mentors.groupInventory,
        maxActiveStudents: mentors.maxActiveStudents,
        createdAt: mentors.createdAt,
        activeMenteeCount: sql<number>`COUNT(DISTINCT ${seatReservations.id})`,
        totalCompletedSessions: sql<number>`COALESCE(SUM(CASE WHEN ${sessions.status} = 'completed' THEN 1 ELSE 0 END), 0)::int`,
      })
      .from(mentors)
      .innerJoin(users, eq(mentors.userId, users.id))
      .leftJoin(seatReservations, and(eq(seatReservations.mentorId, mentors.id), eq(seatReservations.status, "active")))
      .leftJoin(sessionPacks, and(eq(sessionPacks.mentorId, mentors.id), eq(sessionPacks.id, seatReservations.sessionPackId)))
      .leftJoin(sessions, and(eq(sessions.sessionPackId, sessionPacks.id), eq(sessions.status, "completed")))
      .where(isNull(mentors.deletedAt))
      .groupBy(mentors.id, users.id, users.email, mentors.bio, mentors.oneOnOneInventory, mentors.groupInventory, mentors.maxActiveStudents, mentors.createdAt)
      .orderBy(desc(mentors.createdAt))
      .limit(pageSize)
      .offset(offset);

    return {
      instructors: results.map((r) => ({
        mentorId: r.mentorId,
        userId: r.userId,
        email: r.email,
        bio: r.bio,
        oneOnOneInventory: r.oneOnOneInventory,
        groupInventory: r.groupInventory,
        maxActiveStudents: r.maxActiveStudents,
        activeMenteeCount: Number(r.activeMenteeCount) || 0,
        totalCompletedSessions: r.totalCompletedSessions,
        createdAt: r.createdAt,
      })),
      total,
    };
  });
}

export async function getInstructorWithMentees(
  mentorId: string
): Promise<InstructorWithMentees | null> {
  const instructorResult = await db
    .select({
      mentorId: mentors.id,
      userId: users.id,
      email: users.email,
      bio: mentors.bio,
      oneOnOneInventory: mentors.oneOnOneInventory,
      groupInventory: mentors.groupInventory,
      maxActiveStudents: mentors.maxActiveStudents,
      createdAt: mentors.createdAt,
      activeMenteeCount: sql<number>`COUNT(DISTINCT ${seatReservations.id})`,
      totalCompletedSessions: sql<number>`COALESCE(SUM(CASE WHEN ${sessions.status} = 'completed' THEN 1 ELSE 0 END), 0)::int`,
    })
    .from(mentors)
    .innerJoin(users, eq(mentors.userId, users.id))
    .leftJoin(seatReservations, and(eq(seatReservations.mentorId, mentors.id), eq(seatReservations.status, "active")))
    .leftJoin(sessionPacks, and(eq(sessionPacks.mentorId, mentors.id), eq(sessionPacks.id, seatReservations.sessionPackId)))
    .leftJoin(sessions, eq(sessions.sessionPackId, sessionPacks.id))
    .where(and(eq(mentors.id, mentorId), isNull(mentors.deletedAt)))
    .groupBy(mentors.id, users.id, users.email, mentors.bio, mentors.oneOnOneInventory, mentors.groupInventory, mentors.maxActiveStudents, mentors.createdAt)
    .limit(1);

  if (instructorResult.length === 0) {
    return null;
  }

  const instructor = instructorResult[0];

  const menteesResult = await db
    .select({
      userId: users.id,
      email: users.email,
      sessionPackId: sessionPacks.id,
      totalSessions: sessionPacks.totalSessions,
      remainingSessions: sessionPacks.remainingSessions,
      status: sessionPacks.status,
      expiresAt: sessionPacks.expiresAt,
      lastSessionCompletedAt: sql<Date | null>`(
        SELECT MAX(${sessions.completedAt})
        FROM ${sessions}
        WHERE ${sessions.sessionPackId} = ${sessionPacks.id}
          AND ${sessions.status} = 'completed'
      )`,
      completedSessionCount: sql<number>`(SELECT COUNT(*) FROM ${sessions} WHERE ${sessions.sessionPackId} = ${sessionPacks.id} AND ${sessions.status} = 'completed')`,
      seatStatus: seatReservations.status,
      seatExpiresAt: seatReservations.seatExpiresAt,
    })
    .from(sessionPacks)
    .innerJoin(users, eq(sessionPacks.userId, users.id))
    .innerJoin(seatReservations, and(eq(seatReservations.sessionPackId, sessionPacks.id), eq(seatReservations.mentorId, mentorId)))
    .where(eq(sessionPacks.mentorId, mentorId))
    .orderBy(desc(sessionPacks.createdAt));

  const mentees: MenteeWithSessionInfo[] = menteesResult.map((m) => ({
    userId: m.userId,
    email: m.email,
    sessionPackId: m.sessionPackId,
    totalSessions: m.totalSessions,
    remainingSessions: m.remainingSessions,
    status: m.status,
    expiresAt: m.expiresAt,
    lastSessionCompletedAt: m.lastSessionCompletedAt,
    completedSessionCount: Number(m.completedSessionCount),
    seatStatus: m.seatStatus,
    seatExpiresAt: m.seatExpiresAt,
  }));

  return {
    mentorId: instructor.mentorId,
    userId: instructor.userId,
    email: instructor.email,
    bio: instructor.bio,
    oneOnOneInventory: instructor.oneOnOneInventory,
    groupInventory: instructor.groupInventory,
    maxActiveStudents: instructor.maxActiveStudents,
    activeMenteeCount: Number(instructor.activeMenteeCount) || 0,
    totalCompletedSessions: instructor.totalCompletedSessions,
    createdAt: instructor.createdAt,
    mentees,
  };
}

export async function getInstructorMenteesForCsv(
  mentorId: string
): Promise<MenteeWithSessionInfo[]> {
  const results = await db
    .select({
      userId: users.id,
      email: users.email,
      sessionPackId: sessionPacks.id,
      totalSessions: sessionPacks.totalSessions,
      remainingSessions: sessionPacks.remainingSessions,
      status: sessionPacks.status,
      expiresAt: sessionPacks.expiresAt,
      lastSessionCompletedAt: sql<Date | null>`(
        SELECT MAX(${sessions.completedAt})
        FROM ${sessions}
        WHERE ${sessions.sessionPackId} = ${sessionPacks.id}
          AND ${sessions.status} = 'completed'
      )`,
      completedSessionCount: sql<number>`(SELECT COUNT(*) FROM ${sessions} WHERE ${sessions.sessionPackId} = ${sessionPacks.id} AND ${sessions.status} = 'completed')`,
      seatStatus: seatReservations.status,
      seatExpiresAt: seatReservations.seatExpiresAt,
    })
    .from(sessionPacks)
    .innerJoin(users, eq(sessionPacks.userId, users.id))
    .innerJoin(seatReservations, and(eq(seatReservations.sessionPackId, sessionPacks.id), eq(seatReservations.mentorId, mentorId)))
    .where(eq(sessionPacks.mentorId, mentorId))
    .orderBy(desc(sessionPacks.createdAt));

  return results.map((r) => ({
    userId: r.userId,
    email: r.email,
    sessionPackId: r.sessionPackId,
    totalSessions: r.totalSessions,
    remainingSessions: r.remainingSessions,
    status: r.status,
    expiresAt: r.expiresAt,
    lastSessionCompletedAt: r.lastSessionCompletedAt,
    completedSessionCount: Number(r.completedSessionCount),
    seatStatus: r.seatStatus,
    seatExpiresAt: r.seatExpiresAt,
  }));
}

export type FullAdminReportRow = {
  instructorEmail: string;
  menteeEmail: string;
  totalSessions: number;
  remainingSessions: number;
  packStatus: SessionPackStatus;
  packExpiresAt: Date;
  lastSessionDate: Date | null;
  completedSessionsCount: number;
  seatStatus: string;
};

export async function getFullAdminCsvData(): Promise<FullAdminReportRow[]> {
  const results = await db
    .select({
      instructorEmail: instructorUsers.email,
      menteeEmail: users.email,
      totalSessions: sessionPacks.totalSessions,
      remainingSessions: sessionPacks.remainingSessions,
      packStatus: sessionPacks.status,
      packExpiresAt: sessionPacks.expiresAt,
      lastSessionDate: sql<Date | null>`(
        SELECT MAX(${sessions.completedAt})
        FROM ${sessions}
        WHERE ${sessions.sessionPackId} = ${sessionPacks.id}
          AND ${sessions.status} = 'completed'
      )`,
      completedSessionCount: sql<number>`(SELECT COUNT(*) FROM ${sessions} WHERE ${sessions.sessionPackId} = ${sessionPacks.id} AND ${sessions.status} = 'completed')`,
      seatStatus: seatReservations.status,
    })
    .from(sessionPacks)
    .innerJoin(users, eq(sessionPacks.userId, users.id))
    .innerJoin(seatReservations, eq(seatReservations.sessionPackId, sessionPacks.id))
    .innerJoin(mentors, and(eq(sessionPacks.mentorId, mentors.id), isNull(mentors.deletedAt)))
    .innerJoin(instructorUsers, eq(mentors.userId, instructorUsers.id))
    .orderBy(desc(sessionPacks.createdAt));

  return results.map((r) => ({
    instructorEmail: r.instructorEmail,
    menteeEmail: r.menteeEmail,
    totalSessions: r.totalSessions,
    remainingSessions: r.remainingSessions,
    packStatus: r.packStatus,
    packExpiresAt: r.packExpiresAt,
    lastSessionDate: r.lastSessionDate,
    completedSessionsCount: r.completedSessionsCount,
    seatStatus: r.seatStatus,
  }));
}
