import { NextRequest, NextResponse } from "next/server";
import { GET as getStudents } from "../route";

// Backward-compatible alias: nested students route delegates to parent students handler
export async function GET(req: NextRequest) {
  // Delegate to students handler
  return getStudents(req);
}
