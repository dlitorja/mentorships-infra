import { NextRequest, NextResponse } from "next/server";
import * as menteeRoute from "../../mentees/invite/route";

// Alias students invite to mentees invite implementation (until Convex schema rename)
export async function GET(req: NextRequest) {
  return menteeRoute.GET(req);
}

export async function POST(req: NextRequest) {
  return menteeRoute.POST(req);
}
