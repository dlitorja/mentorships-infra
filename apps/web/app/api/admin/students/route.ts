import { NextRequest, NextResponse } from "next/server";
import { GET as getMentees } from "../mentees/route";

// Backward-compatible alias: new students endpoint calls existing mentees handler
export async function GET(req: NextRequest) {
  return getMentees(req);
}
