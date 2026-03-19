import { eq, desc, inArray, sql } from "drizzle-orm";
import { db } from "../drizzle";
import { monthlyStorageCosts } from "../../schema";
import type { MonthlyStorageCost } from "../../schema";

export type { MonthlyStorageCost, NewMonthlyStorageCost } from "../../schema";

/**
 * Get cost record for a specific month
 */
export async function getMonthlyCost(month: string): Promise<MonthlyStorageCost | undefined> {
  const [cost] = await db
    .select()
    .from(monthlyStorageCosts)
    .where(eq(monthlyStorageCosts.month, month))
    .limit(1);
  
  return cost;
}

/**
 * Get current month's cost record
 */
export async function getCurrentMonthCost(): Promise<MonthlyStorageCost | undefined> {
  const currentMonth = new Date().toISOString().slice(0, 7);
  return getMonthlyCost(currentMonth);
}

/**
 * Get all monthly costs ordered by month descending
 */
export async function getAllMonthlyCosts(): Promise<MonthlyStorageCost[]> {
  return db
    .select()
    .from(monthlyStorageCosts)
    .orderBy(desc(monthlyStorageCosts.month));
}

/**
 * Get recent months' costs (default: 12 months)
 */
export async function getRecentMonthlyCosts(months: number = 12): Promise<MonthlyStorageCost[]> {
  const records = await db
    .select()
    .from(monthlyStorageCosts)
    .orderBy(desc(monthlyStorageCosts.month))
    .limit(months);
  
  return records;
}

/**
 * Upsert monthly cost record
 */
export async function upsertMonthlyCost(data: {
  month: string;
  b2StorageCost: number;
  b2DownloadCost: number;
  b2ApiCost: number;
  s3StorageCost: number;
  s3RetrievalCost: number;
  totalCost: number;
  alertThreshold?: number;
}): Promise<MonthlyStorageCost> {
  const [cost] = await db
    .insert(monthlyStorageCosts)
    .values({
      id: crypto.randomUUID(),
      ...data,
    })
    .onConflictDoUpdate({
      target: monthlyStorageCosts.month,
      set: {
        b2StorageCost: data.b2StorageCost,
        b2DownloadCost: data.b2DownloadCost,
        b2ApiCost: data.b2ApiCost,
        s3StorageCost: data.s3StorageCost,
        s3RetrievalCost: data.s3RetrievalCost,
        totalCost: data.totalCost,
        alertThreshold: data.alertThreshold,
        updatedAt: new Date(),
      },
    })
    .returning();
  
  return cost;
}

/**
 * Update alert status for a month
 */
export async function updateAlertStatus(month: string, alertSent: boolean): Promise<MonthlyStorageCost | undefined> {
  const [cost] = await db
    .update(monthlyStorageCosts)
    .set({
      alertSent,
      updatedAt: new Date(),
    })
    .where(eq(monthlyStorageCosts.month, month))
    .returning();
  
  return cost;
}

/**
 * Get months where alert threshold was exceeded
 */
export async function getMonthsOverThreshold(): Promise<MonthlyStorageCost[]> {
  return db
    .select()
    .from(monthlyStorageCosts)
    .where(sql`${monthlyStorageCosts.totalCost} > ${monthlyStorageCosts.alertThreshold}`)
    .orderBy(desc(monthlyStorageCosts.month));
}

/**
 * Calculate total costs over a period
 */
export async function getTotalCostsForPeriod(months: string[]): Promise<{
  b2StorageCost: number;
  b2DownloadCost: number;
  b2ApiCost: number;
  s3StorageCost: number;
  s3RetrievalCost: number;
  totalCost: number;
}> {
  if (months.length === 0) {
    return {
      b2StorageCost: 0,
      b2DownloadCost: 0,
      b2ApiCost: 0,
      s3StorageCost: 0,
      s3RetrievalCost: 0,
      totalCost: 0,
    };
  }

  const records = await db
    .select()
    .from(monthlyStorageCosts)
    .where(inArray(monthlyStorageCosts.month, months));
  
  return records.reduce(
    (acc, record) => ({
      b2StorageCost: acc.b2StorageCost + record.b2StorageCost,
      b2DownloadCost: acc.b2DownloadCost + record.b2DownloadCost,
      b2ApiCost: acc.b2ApiCost + record.b2ApiCost,
      s3StorageCost: acc.s3StorageCost + record.s3StorageCost,
      s3RetrievalCost: acc.s3RetrievalCost + record.s3RetrievalCost,
      totalCost: acc.totalCost + record.totalCost,
    }),
    {
      b2StorageCost: 0,
      b2DownloadCost: 0,
      b2ApiCost: 0,
      s3StorageCost: 0,
      s3RetrievalCost: 0,
      totalCost: 0,
    }
  );
}
