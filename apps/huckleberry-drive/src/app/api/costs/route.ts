import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  getRecentMonthlyCosts,
  getMonthsOverThreshold,
  UnauthorizedError,
  ForbiddenError,
} from "@mentorships/db";
import {
  formatCost,
  estimateB2StorageCost,
  estimateS3StorageCost,
} from "@mentorships/storage";
import { db } from "@mentorships/db";
import { instructorUploads } from "@mentorships/db";
import { eq, inArray, sql } from "drizzle-orm";
import type { MonthlyStorageCost } from "@mentorships/db";

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
          total: sql<number>`COALESCE(SUM(size)::bigint, 0)`,
        })
        .from(instructorUploads)
        .where(inArray(instructorUploads.status, ["completed", "archived"]));
      
      const totalArchivedBytes = await db
        .select({
          total: sql<number>`COALESCE(SUM(size)::bigint, 0)`,
        })
        .from(instructorUploads)
        .where(eq(instructorUploads.status, "archived"));
      
      const activeBytes = totalBytes[0]?.total || 0;
      const archivedBytes = totalArchivedBytes[0]?.total || 0;
      
      const estimatedCurrent: MonthlyStorageCost = {
        id: "",
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
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      currentCost = estimatedCurrent;
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
    
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
