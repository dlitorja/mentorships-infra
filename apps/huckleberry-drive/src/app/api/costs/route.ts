import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import {
  formatCost,
  estimateB2StorageCost,
  estimateS3StorageCost,
} from "@mentorships/storage";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();

    const url = new URL(request.url);
    const period = url.searchParams.get("period") || "6";
    const months = parseInt(period, 10) || 6;

    // TODO: Implement Convex queries for cost data
    // For now, return empty data to avoid SQL dependency
    const recentCosts: Array<{ month: string; totalCost: number }> = [];

    const currentMonth = new Date().toISOString().slice(0, 7);

    // Placeholder current cost calculation
    const estimatedCurrent = {
      month: currentMonth,
      b2StorageCost: 0,
      b2DownloadCost: 0,
      b2ApiCost: 0,
      s3StorageCost: 0,
      s3RetrievalCost: 0,
      totalCost: 0,
      alertSent: false,
      alertThreshold: 5000,
    };

    const currentCost = estimatedCurrent;

    // TODO: Implement Convex query for months over threshold
    const monthsOverThreshold: Array<{ month: string; totalCost: number; alertThreshold: number }> = [];

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