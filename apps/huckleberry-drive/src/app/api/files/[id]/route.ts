import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}