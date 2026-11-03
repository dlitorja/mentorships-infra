import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { CostData, CostResponse } from "@/lib/api";

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin();

    const { getToken } = await auth();
    const convexToken = await getToken({ template: "convex" }) ?? undefined;

    const costData = await fetchQuery(api.monthlyStorageCosts.list, {}, { token: convexToken });

    // `currentMonth` is null until a cost record exists for the month.
    // Preserve that rather than coercing to zeros — the UI shows a
    // "cost data not yet available" state instead of a fake $0.00.
    const record = costData.currentMonth;
    const currentMonth: CostData | null = record
      ? {
          month: record.month,
          b2StorageCost: record.b2StorageCost ?? 0,
          b2DownloadCost: record.b2DownloadCost ?? 0,
          b2ApiCost: record.b2ApiCost ?? 0,
          s3StorageCost: record.s3StorageCost ?? 0,
          s3RetrievalCost: record.s3RetrievalCost ?? 0,
          totalCost: record.totalCost ?? 0,
        }
      : null;

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