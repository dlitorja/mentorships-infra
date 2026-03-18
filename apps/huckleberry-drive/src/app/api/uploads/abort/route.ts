import { NextResponse } from "next/server";

export function POST(): NextResponse {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}