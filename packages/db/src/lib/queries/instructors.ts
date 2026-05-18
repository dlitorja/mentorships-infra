import { db } from "../drizzle";
import {
  instructors,
  instructorTestimonials,
  studentResults,
  type Instructor,
  type InstructorTestimonial,
  type StudentResult,
  type NewInstructor,
  type NewInstructorTestimonial,
  type NewStudentResult,
} from "../../schema/instructors";
import { eq, desc, asc, ilike, or, and, sql } from "drizzle-orm";

export async function getInstructorByUserId(userId: string): Promise<Instructor | null> {
  const [result] = await db
    .select()
    .from(instructors)
    .where(eq(instructors.userId, userId))
    .limit(1);
  return result || null;
}

export async function getInstructors(options?: {
  includeInactive?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: Instructor[]; total: number }> {
  const { includeInactive = false, search, limit = 50, offset = 0 } = options || {};
  
  const conditions = [];
  
  if (!includeInactive) {
    conditions.push(eq(instructors.isActive, true));
  }
  
  if (search) {
    conditions.push(
      or(
        ilike(instructors.name, `%${search}%`),
        ilike(instructors.tagline, `%${search}%`),
        ilike(instructors.bio, `%${search}%`)
      )
    );
  }
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  
  const [items, countResult] = await Promise.all([
    db.select()
      .from(instructors)
      .where(whereClause)
      .orderBy(asc(instructors.name))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` })
      .from(instructors)
      .where(whereClause),
  ]);

  return { items, total: Number(countResult[0]?.count || 0) };
}

export async function getInstructorById(id: string): Promise<Instructor | null> {
  const result = await db.select()
    .from(instructors)
    .where(eq(instructors.id, id))
    .limit(1);
  return result[0] || null;
}

export async function getInstructorBySlug(slug: string): Promise<Instructor | null> {
  const result = await db.select()
    .from(instructors)
    .where(eq(instructors.slug, slug))
    .limit(1);
  return result[0] || null;
}

export async function createInstructor(data: Omit<NewInstructor, "id" | "createdAt" | "updatedAt">): Promise<Instructor> {
  const result = await db.insert(instructors)
    .values(data)
    .returning();
  return result[0];
}

export async function updateInstructor(id: string, data: Partial<Omit<NewInstructor, "id" | "createdAt" | "updatedAt">>): Promise<Instructor> {
  const result = await db.update(instructors)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(instructors.id, id))
    .returning();
  return result[0];
}

export async function deleteInstructor(id: string): Promise<void> {
  await db.delete(instructors).where(eq(instructors.id, id));
}

export async function getTestimonialsByInstructorId(instructorId: string): Promise<InstructorTestimonial[]> {
  return db.select()
    .from(instructorTestimonials)
    .where(eq(instructorTestimonials.instructorId, instructorId))
    .orderBy(desc(instructorTestimonials.createdAt));
}

export async function createTestimonial(data: Omit<NewInstructorTestimonial, "id" | "createdAt">): Promise<InstructorTestimonial> {
  const result = await db.insert(instructorTestimonials)
    .values(data)
    .returning();
  return result[0];
}

export async function deleteTestimonial(id: string): Promise<void> {
  await db.delete(instructorTestimonials).where(eq(instructorTestimonials.id, id));
}

export async function getStudentResultsByInstructorId(instructorId: string): Promise<StudentResult[]> {
  return db.select()
    .from(studentResults)
    .where(eq(studentResults.instructorId, instructorId))
    .orderBy(desc(studentResults.createdAt));
}

export async function getStudentResultsByUserId(userId: string): Promise<StudentResult[]> {
  return db.select()
    .from(studentResults)
    .where(eq(studentResults.createdBy, userId))
    .orderBy(desc(studentResults.createdAt));
}

export async function createStudentResult(data: Omit<NewStudentResult, "id" | "createdAt">): Promise<StudentResult> {
  const result = await db.insert(studentResults)
    .values(data)
    .returning();
  return result[0];
}

export async function deleteStudentResult(id: string): Promise<void> {
  await db.delete(studentResults).where(eq(studentResults.id, id));
}

export async function getTestimonialsByUserId(userId: string): Promise<(InstructorTestimonial & { instructor: Instructor })[]> {
  const [instructor] = await db
    .select()
    .from(instructors)
    .where(eq(instructors.userId, userId))
    .limit(1);
  if (!instructor) return [];
  
  const testimonials = await getTestimonialsByInstructorId(instructor.id);
  return testimonials.map(t => ({ ...t, instructor }));
}
