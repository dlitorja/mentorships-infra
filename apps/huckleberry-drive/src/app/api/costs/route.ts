import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin();
    return NextResponse.json({
      currentMonth: null,
      historical: [],
      alerts: [],
    });
  } catch (error) {
    if (error instanceof Error && error.name === "UnauthorizedError") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.name === "ForbiddenError") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}