import { NextRequest, NextResponse } from "next/server";
import { GET as getStudents } from "../route";

/**
 * GET /api/admin/students/invite
 * Backward-compatible alias that delegates to GET /api/admin/students.
 * Returns paginated student list (same as admin/students).
 */
export async function GET(req: NextRequest) {
  // Delegate to students handler
  return getStudents(req);
}
