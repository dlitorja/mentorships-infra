import { NextResponse } from "next/server";
import { createApiSuccess, databaseError } from "@/lib/api-error";
import { db, sql } from "@mentorships/db";

interface DatabaseHealthStatus {
  status: string;
  timestamp: string;
  responseTime: string;
  database: {
    connected: boolean;
    queryTime: number;
    status?: string;
  };
}

/**
 * GET /api/health/db
 * Database connection health check
 * Verifies database connectivity and basic query execution
 */
export async function GET(): Promise<NextResponse> {
  try {
    const startTime = Date.now();

    // Test basic database connectivity with a simple query
    await db.execute(sql`SELECT 1`);

    const responseTime = Date.now() - startTime;

    const status: DatabaseHealthStatus = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      database: {
        connected: true,
        queryTime: responseTime,
      },
    };
    
    // Slow database warnings
    if (responseTime > 1000) {
      status.database.status = "slow";
      status.status = "degraded";
    }
    
    return NextResponse.json(createApiSuccess(status, "Database is healthy"));
  } catch (error) {
    console.error("Database health check failed:", error);
    const { response: errorResponse } = databaseError("Database connection failed");
    return NextResponse.json(errorResponse, { status: 503 });
  }
}
