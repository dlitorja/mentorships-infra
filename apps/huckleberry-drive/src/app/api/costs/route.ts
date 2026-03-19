import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  getCurrentMonthCost,
  getRecentMonthlyCosts,
  getMonthsOverThreshold,
} from "@mentorships/db";
import {
  fetchMonthlyCosts,
  formatCost,
  estimateB2StorageCost,
  estimateS3StorageCost,
} from "@mentorships/storage";
import { getInstructorStorageUsage, getInstructorUploads } from "@mentorships/db";
import { db } from "@mentorships/db";
import { instructorUploads } from "@mentorships/db";
import { sql } from "drizzle-orm";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();
    
    const url = new URL(request.url);
    const period = url.searchParams.get("period") || "6";
    const months = parseInt(period, 10) || 6;
    
    const recentCosts = await getRecentMonthlyCosts(months);
    
    const currentMonth = new Date().toISOString().slice(0, 7);
    let currentCost = recentCosts.find((c) => c.month === currentMonth);
    
    if (!currentCost) {
      const totalBytes = await db
        .select({
          total: sql<number>`COALESCE(SUM(size), 0)`,
        })
        .from(instructorUploads)
        .where(sql`status IN ('completed', 'archived')`);
      
      const totalArchivedBytes = await db
        .select({
          total: sql<number>`COALESCE(SUM(size), 0)`,
        })
        .from(instructorUploads)
        .where(sql`status = 'archived'`);
      
      const activeBytes = totalBytes[0]?.total || 0;
      const archivedBytes = totalArchivedBytes[0]?.total || 0;
      
      const estimatedCurrent = {
        month: currentMonth,
        b2StorageCost: estimateB2StorageCost(activeBytes - archivedBytes),
        b2DownloadCost: 0,
        b2ApiCost: 0,
        s3StorageCost: estimateS3StorageCost(archivedBytes),
        s3RetrievalCost: 0,
        totalCost:
          estimateB2StorageCost(activeBytes - archivedBytes) +
          estimateS3StorageCost(archivedBytes),
        alertSent: false,
        alertThreshold: 5000,
      };
      
      currentCost = estimatedCurrent as typeof currentCost;
    }
    
    const monthsOverThreshold = await getMonthsOverThreshold();
    
    const summary = {
      currentMonth: {
        month: currentCost.month,
        b2Storage: formatCost(currentCost.b2StorageCost),
        b2Download: formatCost(currentCost.b2DownloadCost),
        b2Api: formatCost(currentCost.b2ApiCost),
        s3Storage: formatCost(currentCost.s3StorageCost),
        s3Retrieval: formatCost(currentCost.s3RetrievalCost),
        total: formatCost(currentCost.totalCost),
        alertThreshold: formatCost(currentCost.alertThreshold),
        isOverThreshold: currentCost.totalCost > currentCost.alertThreshold,
      },
      historical: recentCosts.map((cost) => ({
        month: cost.month,
        total: formatCost(cost.totalCost),
        totalCents: cost.totalCost,
      })),
      alerts: monthsOverThreshold.map((cost) => ({
        month: cost.month,
        total: formatCost(cost.totalCost),
        threshold: formatCost(cost.alertThreshold),
      })),
    };
    
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Costs error:", error);
    
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
