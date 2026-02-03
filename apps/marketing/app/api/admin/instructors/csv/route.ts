import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getFullAdminCsvData } from "@mentorships/db";

function formatDate(date: Date | null): string {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0];
}

function escapeCsvField(field: string | number | boolean | null | undefined): string {
  if (field === null || field === undefined) return "";
  const str = String(field);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(): Promise<Response> {
  try {
    await requireAdmin();

    const data = await getFullAdminCsvData();

    const headers = [
      "Instructor Email",
      "Mentee Email",
      "Total Sessions",
      "Remaining Sessions",
      "Pack Status",
      "Pack Expires At",
      "Last Session Date",
      "Completed Sessions Count",
      "Seat Status",
    ];

    const csvRows = [
      headers.map(escapeCsvField).join(","),
      ...data.map((row) =>
        [
          escapeCsvField(row.instructorEmail),
          escapeCsvField(row.menteeEmail),
          escapeCsvField(row.totalSessions),
          escapeCsvField(row.remainingSessions),
          escapeCsvField(row.packStatus),
          escapeCsvField(formatDate(row.packExpiresAt)),
          escapeCsvField(formatDate(row.lastSessionDate)),
          escapeCsvField(row.completedSessionsCount),
          escapeCsvField(row.seatStatus),
        ].join(",")
      ),
    ];

    const csvContent = csvRows.join("\n");

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="instructors-mentees-report-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    });
  } catch (error) {
    console.error("Error generating CSV:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
