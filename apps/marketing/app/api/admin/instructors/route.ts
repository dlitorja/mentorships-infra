import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { getAllInstructorsWithStats } from "@mentorships/db";

const searchSchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().positive().optional().default(1),
  pageSize: z.coerce.number().positive().max(100).optional().default(50),
});

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const parseResult = searchSchema.safeParse(Object.fromEntries(searchParams));

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { search, page, pageSize } = parseResult.data;

    const result = await getAllInstructorsWithStats(search, page, pageSize);

    return NextResponse.json({
      instructors: result.instructors,
      total: result.total,
      page,
      pageSize,
      totalPages: Math.ceil(result.total / pageSize),
    });
  } catch (error) {
    console.error("Error fetching instructors:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
