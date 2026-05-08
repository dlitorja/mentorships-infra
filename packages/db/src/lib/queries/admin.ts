import { eq, desc, sql, and, gte, ilike, or, isNull, aliasedTable, count, sum, inArray } from "drizzle-orm";
import { db } from "../drizzle";
import { mentors, users, sessionPacks, sessions, seatReservations, orders, payments, instructors } from "../../schema";
import type { SessionPackStatus } from "../../schema/sessionPacks";
import type { OrderStatus } from "../../schema/orders";

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
  expiresAt: Date | null;
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

    return await db.transaction(async (tx: typeof db) => {
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
        instructors: results.map((r: typeof results[number]) => ({
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

  return await db.transaction(async (tx: typeof db) => {
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
      instructors: results.map((r: typeof results[number]) => ({
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

  const mentees: MenteeWithSessionInfo[] = menteesResult.map((m: typeof menteesResult[number]) => ({
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

  return results.map((r: typeof results[number]) => ({
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
  packExpiresAt: Date | null;
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
      completedSessionsCount: sql<number>`(SELECT COUNT(*) FROM ${sessions} WHERE ${sessions.sessionPackId} = ${sessionPacks.id} AND ${sessions.status} = 'completed')`,
      seatStatus: seatReservations.status,
    })
    .from(sessionPacks)
    .innerJoin(users, eq(sessionPacks.userId, users.id))
    .innerJoin(seatReservations, eq(seatReservations.sessionPackId, sessionPacks.id))
    .innerJoin(mentors, and(eq(sessionPacks.mentorId, mentors.id), isNull(mentors.deletedAt)))
    .innerJoin(instructorUsers, eq(mentors.userId, instructorUsers.id))
    .orderBy(desc(sessionPacks.createdAt));

  return results.map((r: typeof results[number]) => ({
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

export type AdminStats = {
  totalActiveMentees: number;
  revenueThisMonth: number;
  revenueLastMonth: number;
  revenueChange: number;
  revenueThisYear: number;
  hasRevenueData: boolean;
  hasMenteeData: boolean;
  hasHistoricalRevenue: boolean;
};

export async function getAdminStats(): Promise<AdminStats> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  const [statsResult, revenueResult] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(DISTINCT ${seatReservations.sessionPackId})` })
      .from(seatReservations)
      .innerJoin(sessionPacks, eq(seatReservations.sessionPackId, sessionPacks.id))
      .where(and(
        eq(seatReservations.status, "active"),
        eq(sessionPacks.status, "active")
      )),
    db
      .select({
        revenueThisMonth: sql<number>`COALESCE(SUM(CASE WHEN ${payments.createdAt} >= ${startOfMonth} THEN ${payments.amount}::numeric ELSE 0 END), 0)::numeric`,
        revenueLastMonth: sql<number>`COALESCE(SUM(CASE WHEN ${payments.createdAt} >= ${startOfLastMonth} AND ${payments.createdAt} < ${startOfMonth} THEN ${payments.amount}::numeric ELSE 0 END), 0)::numeric`,
        revenueThisYear: sql<number>`COALESCE(SUM(CASE WHEN ${payments.createdAt} >= ${startOfYear} THEN ${payments.amount}::numeric ELSE 0 END), 0)::numeric`,
      })
      .from(payments)
      .where(eq(payments.status, "completed")),
  ]);

  const totalActiveMentees = Number(statsResult[0]?.count || 0);
  const revenueStats = revenueResult[0] || {
    revenueThisMonth: "0",
    revenueLastMonth: "0",
    revenueThisYear: "0",
  };

  const revenueThisMonth = Number(revenueStats.revenueThisMonth) / 100;
  const revenueLastMonth = Number(revenueStats.revenueLastMonth) / 100;
  const revenueThisYear = Number(revenueStats.revenueThisYear) / 100;

  let revenueChange = 0;
  if (revenueLastMonth > 0) {
    revenueChange = ((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100;
  } else if (revenueThisMonth > 0) {
    revenueChange = 100;
  }

  return {
    totalActiveMentees,
    revenueThisMonth,
    revenueLastMonth,
    revenueChange: Math.round(revenueChange * 10) / 10,
    revenueThisYear,
    hasRevenueData: revenueThisYear > 0,
    hasMenteeData: totalActiveMentees > 0,
    hasHistoricalRevenue: revenueLastMonth > 0,
  };
}

export type AdminMenteeItem = {
  id: string;
  userId: string;
  email: string;
  mentorId: string;
  instructorName: string | null;
  instructorSlug: string | null;
  totalSessions: number;
  remainingSessions: number;
  status: SessionPackStatus;
  expiresAt: Date | null;
  purchasedAt: Date;
  createdAt: Date;
};

export type AdminMenteeResult = {
  items: AdminMenteeItem[];
  total: number;
  page: number;
  pageSize: number;
};

export async function getAdminMentees(
  search?: string,
  instructorId?: string,
  page: number = 1,
  pageSize: number = 20
): Promise<AdminMenteeResult> {
  const offset = (page - 1) * pageSize;

  return await db.transaction(async (tx) => {
    const conditions: any[] = [];

    if (instructorId) {
      conditions.push(eq(sessionPacks.mentorId, instructorId));
    }

    if (search && search.trim()) {
      conditions.push(ilike(users.email, `%${search.trim()}%`));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const countResult = await tx
      .select({ count: sql<number>`count(*)` })
      .from(sessionPacks)
      .innerJoin(users, eq(sessionPacks.userId, users.id))
      .where(whereClause);

    const total = Number(countResult[0]?.count || 0);

    const results = await tx
      .select({
        id: sessionPacks.id,
        userId: sessionPacks.userId,
        email: users.email,
        mentorId: sessionPacks.mentorId,
        instructorName: instructors.name,
        instructorSlug: instructors.slug,
        totalSessions: sessionPacks.totalSessions,
        remainingSessions: sessionPacks.remainingSessions,
        status: sessionPacks.status,
        expiresAt: sessionPacks.expiresAt,
        purchasedAt: sessionPacks.purchasedAt,
        createdAt: sessionPacks.createdAt,
      })
      .from(sessionPacks)
      .innerJoin(users, eq(sessionPacks.userId, users.id))
      .leftJoin(instructors, eq(sessionPacks.mentorId, instructors.id))
      .where(whereClause)
      .orderBy(desc(sessionPacks.createdAt))
      .limit(pageSize)
      .offset(offset);

    return {
      items: results.map(r => ({
        id: r.id,
        userId: r.userId,
        email: r.email || "Unknown",
        mentorId: r.mentorId,
        instructorName: r.instructorName || "Unknown",
        instructorSlug: r.instructorSlug,
        totalSessions: r.totalSessions,
        remainingSessions: r.remainingSessions,
        status: r.status,
        expiresAt: r.expiresAt,
        purchasedAt: r.purchasedAt,
        createdAt: r.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  });
}

export type AdminOrderItem = {
  id: string;
  userId: string;
  userEmail: string | null;
  status: OrderStatus;
  provider: "stripe" | "paypal";
  totalAmount: string;
  currency: string;
  createdAt: Date;
  payments: {
    id: string;
    provider: "stripe" | "paypal";
    providerPaymentId: string;
    amount: string;
    currency: string;
    status: "pending" | "completed" | "refunded" | "failed";
    refundedAmount: string | null;
  }[];
};

export type AdminOrderResult = {
  items: AdminOrderItem[];
  total: number;
  page: number;
  pageSize: number;
};

export async function getAdminOrders(
  page: number = 1,
  pageSize: number = 20
): Promise<AdminOrderResult> {
  const offset = (page - 1) * pageSize;

  return await db.transaction(async (tx) => {
    const countResult = await tx
      .select({ count: sql<number>`count(*)` })
      .from(orders);

    const total = Number(countResult[0]?.count || 0);

    const paginatedOrderIds = await tx
      .select({ id: orders.id })
      .from(orders)
      .orderBy(desc(orders.createdAt))
      .limit(pageSize)
      .offset(offset);

    if (paginatedOrderIds.length === 0) {
      return { items: [], total, page, pageSize };
    }

    const orderIds = paginatedOrderIds.map(o => o.id);

    const orderResults = await tx
      .select({
        id: orders.id,
        userId: orders.userId,
        userEmail: users.email,
        status: orders.status,
        provider: orders.provider,
        totalAmount: orders.totalAmount,
        currency: orders.currency,
        createdAt: orders.createdAt,
        paymentId: payments.id,
        paymentProvider: payments.provider,
        paymentProviderPaymentId: payments.providerPaymentId,
        paymentAmount: payments.amount,
        paymentCurrency: payments.currency,
        paymentStatus: payments.status,
        paymentRefundedAmount: payments.refundedAmount,
      })
      .from(orders)
      .leftJoin(users, eq(orders.userId, users.id))
      .leftJoin(payments, eq(payments.orderId, orders.id))
      .where(inArray(orders.id, orderIds))
      .orderBy(desc(orders.createdAt));

    const ordersMap = new Map<string, AdminOrderItem>();
    for (const row of orderResults) {
      if (!ordersMap.has(row.id)) {
        ordersMap.set(row.id, {
          id: row.id,
          userId: row.userId,
          userEmail: row.userEmail,
          status: row.status,
          provider: row.provider,
          totalAmount: row.totalAmount,
          currency: row.currency,
          createdAt: row.createdAt,
          payments: [],
        });
      }
      if (row.paymentId && row.paymentProvider) {
        ordersMap.get(row.id)!.payments.push({
          id: row.paymentId,
          provider: row.paymentProvider,
          providerPaymentId: row.paymentProviderPaymentId!,
          amount: row.paymentAmount!,
          currency: row.paymentCurrency!,
          status: row.paymentStatus!,
          refundedAmount: row.paymentRefundedAmount,
        });
      }
    }

    const paginatedItems = Array.from(ordersMap.values());

    return {
      items: paginatedItems,
      total,
      page,
      pageSize,
    };
  });
}

export type AdminInstructorItem = {
  id: string;
  userId: string | null;
  email: string | null;
  name: string;
  slug: string;
  bio: string | null;
  tagline: string | null;
  specialties: string[] | null;
  background: string[] | null;
  profileImageUrl: string | null;
  isActive: boolean;
  oneOnOneInventory: number | null;
  groupInventory: number | null;
  maxActiveStudents: number | null;
  createdAt: Date;
  activeMenteeCount: number;
  totalCompletedSessions: number;
};

export type AdminInstructorResult = {
  items: AdminInstructorItem[];
  total: number;
  page: number;
  pageSize: number;
};

export async function getAdminInstructors(
  search?: string,
  includeInactive?: boolean,
  page: number = 1,
  pageSize: number = 20
): Promise<AdminInstructorResult> {
  const offset = (page - 1) * pageSize;

  return await db.transaction(async (tx) => {
    const conditions: any[] = [];
    if (!includeInactive) {
      conditions.push(eq(instructors.isActive, true));
    }

    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      conditions.push(
        or(
          ilike(users.email, searchTerm),
          ilike(instructors.name, searchTerm),
          ilike(instructors.slug, searchTerm)
        )
      );
    }

    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    const countResult = await tx
      .select({ count: sql<number>`count(*)` })
      .from(instructors)
      .leftJoin(users, eq(instructors.userId, users.id))
      .where(whereCondition);

    const total = Number(countResult[0]?.count || 0);

    const results = await tx
      .select({
        id: instructors.id,
        userId: users.id,
        email: users.email,
        name: instructors.name,
        slug: instructors.slug,
        bio: instructors.bio,
        tagline: instructors.tagline,
        specialties: instructors.specialties,
        background: instructors.background,
        profileImageUrl: instructors.profileImageUrl,
        isActive: instructors.isActive,
        oneOnOneInventory: mentors.oneOnOneInventory,
        groupInventory: mentors.groupInventory,
        maxActiveStudents: mentors.maxActiveStudents,
        createdAt: instructors.createdAt,
        activeMenteeCount: sql<number>`COALESCE((
          SELECT COUNT(DISTINCT ${seatReservations.id})
          FROM ${seatReservations}
          WHERE ${seatReservations.mentorId} = ${instructors.mentorId}
            AND ${seatReservations.status} = 'active'
        ), 0)`,
        totalCompletedSessions: sql<number>`COALESCE((
          SELECT COUNT(*)
          FROM ${sessions}
          INNER JOIN ${sessionPacks} ON ${sessions.sessionPackId} = ${sessionPacks.id}
          WHERE ${sessionPacks.mentorId} = ${instructors.mentorId}
            AND ${sessions.status} = 'completed'
        ), 0)`,
      })
      .from(instructors)
      .leftJoin(users, eq(instructors.userId, users.id))
      .leftJoin(mentors, eq(instructors.mentorId, mentors.id))
      .where(whereCondition)
      .orderBy(desc(instructors.createdAt))
      .limit(pageSize)
      .offset(offset);

    return {
      items: results.map(r => ({
        id: r.id,
        userId: r.userId,
        email: r.email,
        name: r.name || "",
        slug: r.slug || "",
        bio: r.bio,
        tagline: r.tagline,
        specialties: r.specialties,
        background: r.background,
        profileImageUrl: r.profileImageUrl,
        isActive: r.isActive ?? true,
        oneOnOneInventory: r.oneOnOneInventory,
        groupInventory: r.groupInventory,
        maxActiveStudents: r.maxActiveStudents,
        createdAt: r.createdAt,
        activeMenteeCount: Number(r.activeMenteeCount) || 0,
        totalCompletedSessions: Number(r.totalCompletedSessions) || 0,
      })),
      total,
      page,
      pageSize,
    };
  });
}
