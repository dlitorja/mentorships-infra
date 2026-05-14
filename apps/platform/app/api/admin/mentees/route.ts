import { NextRequest, NextResponse } from "next/server";
import { GET as getStudents } from "../students/route";

// Backward-compatible alias: /api/admin/mentees -> /api/admin/students
export async function GET(req: NextRequest) {
  // Delegate to students handler
  return getStudents(req);
}
