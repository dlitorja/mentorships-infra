import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@mentorships/db";
import { sql } from "drizzle-orm";

/**
 * Test endpoint to verify Clerk and Supabase configuration
 * GET /api/test - Check if environment variables are set correctly
 */
export async function GET() {
  // Test database connection
  let dbConnectionTest = { status: "unknown", error: null as string | null };
  try {
    // Try a simple query
    await db.execute(sql`SELECT 1 as test`);
    dbConnectionTest.status = "connected";
  } catch (error) {
    dbConnectionTest.status = "failed";
    dbConnectionTest.error = error instanceof Error 
      ? `${error.message}${error.stack ? `\n${error.stack}` : ''}`
      : String(error);
  }
  const checks = {
    clerk: {
      publishableKey: !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: !!process.env.CLERK_SECRET_KEY,
      configured: false,
    },
    supabase: {
      url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      configured: false,
    },
    database: {
      url: !!process.env.DATABASE_URL,
      configured: false,
    },
  };

  // Check if Clerk is configured
  checks.clerk.configured =
    checks.clerk.publishableKey && checks.clerk.secretKey;

  // Check if Supabase is configured
  checks.supabase.configured =
    checks.supabase.url && checks.supabase.anonKey;

  // Check if Database is configured
  checks.database.configured = checks.database.url;

  // Try to get auth status
  let authStatus = "not_authenticated";
  try {
    const { userId } = await auth();
    if (userId) {
      authStatus = "authenticated";
    }
  } catch (error) {
    authStatus = "error";
  }

  const allConfigured =
    checks.clerk.configured &&
    checks.supabase.configured &&
    checks.database.configured;

  return NextResponse.json({
    status: allConfigured && dbConnectionTest.status === "connected" ? "ok" : "missing_config_or_connection_failed",
    checks,
    database: {
      connection: dbConnectionTest.status,
      error: dbConnectionTest.error,
    },
    auth: {
      status: authStatus,
    },
    message: allConfigured && dbConnectionTest.status === "connected"
      ? "All environment variables are configured and database connection is working!"
      : dbConnectionTest.status === "failed"
      ? `Database connection failed: ${dbConnectionTest.error}`
      : "Some environment variables are missing. Check the 'checks' object for details.",
  });
}

