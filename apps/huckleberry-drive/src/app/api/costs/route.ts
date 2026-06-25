import { NextResponse } from "next/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { CostData, CostResponse } from "@/lib/api";

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin();

    const costData = await fetchQuery(api.monthlyStorageCosts.list, {});

    const currentMonth: CostData = {
      month: costData.currentMonth.month,
      b2StorageCost: costData.currentMonth.b2StorageCost ?? 0,
      b2DownloadCost: costData.currentMonth.b2DownloadCost ?? 0,
      b2ApiCost: costData.currentMonth.b2ApiCost ?? 0,
      s3StorageCost: costData.currentMonth.s3StorageCost ?? 0,
      s3RetrievalCost: costData.currentMonth.s3RetrievalCost ?? 0,
      totalCost: costData.currentMonth.totalCost ?? 0,
    };

    const historical: CostData[] = costData.historical.map((record) => ({
      month: record.month,
      b2StorageCost: record.b2StorageCost ?? 0,
      b2DownloadCost: record.b2DownloadCost ?? 0,
      b2ApiCost: record.b2ApiCost ?? 0,
      s3StorageCost: record.s3StorageCost ?? 0,
      s3RetrievalCost: record.s3RetrievalCost ?? 0,
      totalCost: record.totalCost ?? 0,
    }));

    const response: CostResponse = {
      currentMonth,
      historical,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Costs error:", error);

    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}