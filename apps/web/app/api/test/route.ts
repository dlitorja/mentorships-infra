import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

/**
 * Test endpoint to verify Clerk and Supabase configuration
 * GET /api/test - Check if environment variables are set correctly
 */
export async function GET() {
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
  } catch {
    authStatus = "error";
  }

  const allConfigured =
    checks.clerk.configured &&
    checks.supabase.configured &&
    checks.database.configured;

  return NextResponse.json({
    status: allConfigured ? "ok" : "missing_config",
    checks,
    auth: {
      status: authStatus,
    },
    message: allConfigured
      ? "All environment variables are configured!"
      : "Some environment variables are missing. Check the 'checks' object for details.",
  });
}

