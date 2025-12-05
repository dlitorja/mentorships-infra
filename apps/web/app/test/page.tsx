import { auth, currentUser } from "@clerk/nextjs/server";
import { getOrCreateUser } from "@mentorships/db";
import Link from "next/link";

/**
 * Test page to verify Clerk and Supabase integration
 * This page helps verify that everything is working correctly
 */
export default async function TestPage() {
  const { userId } = await auth();
  const clerkUser = await currentUser();

  let dbUser = null;
  let dbError = null;
  if (userId) {
    try {
      dbUser = await getOrCreateUser();
    } catch (error) {
      dbError = error instanceof Error ? error.message : "Unknown error";
    }
  }

  return (
    <div className="container mx-auto p-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">Configuration Test Page</h1>

      <div className="space-y-6">
        {/* Environment Variables Check */}
        <section className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Environment Variables</h2>
          <div className="space-y-2 font-mono text-sm">
            <div>
              <span className="font-semibold">Clerk Publishable Key:</span>{" "}
              {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
                ? "✅ Set"
                : "❌ Missing"}
            </div>
            <div>
              <span className="font-semibold">Clerk Secret Key:</span>{" "}
              {process.env.CLERK_SECRET_KEY ? "✅ Set" : "❌ Missing"}
            </div>
            <div>
              <span className="font-semibold">Supabase URL:</span>{" "}
              {process.env.NEXT_PUBLIC_SUPABASE_URL ? "✅ Set" : "❌ Missing"}
            </div>
            <div>
              <span className="font-semibold">Supabase Anon Key:</span>{" "}
              {process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "✅ Set" : "❌ Missing"}
            </div>
            <div>
              <span className="font-semibold">Database URL:</span>{" "}
              {process.env.DATABASE_URL ? "✅ Set" : "❌ Missing"}
            </div>
          </div>
        </section>

        {/* Clerk Authentication Status */}
        <section className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Clerk Authentication</h2>
          {userId ? (
            <div className="space-y-2">
              <div className="text-green-600">✅ Authenticated</div>
              <div className="font-mono text-sm">
                <div>
                  <span className="font-semibold">User ID:</span> {userId}
                </div>
                {clerkUser && (
                  <>
                    <div>
                      <span className="font-semibold">Email:</span>{" "}
                      {clerkUser.emailAddresses[0]?.emailAddress || "N/A"}
                    </div>
                    <div>
                      <span className="font-semibold">Name:</span>{" "}
                      {clerkUser.firstName} {clerkUser.lastName}
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="text-yellow-600">
              ⚠️ Not authenticated.{" "}
              <Link href="/sign-in" className="underline">
                Sign in
              </Link>{" "}
              to test user sync.
            </div>
          )}
        </section>

        {/* Database User Sync Status */}
        <section className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Database User Sync</h2>
          {!userId ? (
            <div className="text-gray-500">
              Sign in first to test user sync to Supabase.
            </div>
          ) : dbError ? (
            <div className="text-red-600">
              ❌ Error syncing user: {dbError}
            </div>
          ) : dbUser ? (
            <div className="space-y-2">
              <div className="text-green-600">✅ User synced to Supabase</div>
              <div className="font-mono text-sm">
                <div>
                  <span className="font-semibold">ID:</span> {dbUser.id}
                </div>
                <div>
                  <span className="font-semibold">Email:</span> {dbUser.email}
                </div>
                <div>
                  <span className="font-semibold">Role:</span> {dbUser.role}
                </div>
                <div>
                  <span className="font-semibold">Created:</span>{" "}
                  {new Date(dbUser.createdAt).toLocaleString()}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-yellow-600">⚠️ User not found in database</div>
          )}
        </section>

        {/* Quick Actions */}
        <section className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
          <div className="flex gap-4">
            <Link
              href="/api/test"
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              target="_blank"
            >
              Test API Endpoint
            </Link>
            <Link
              href="/api/health"
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              target="_blank"
            >
              Health Check
            </Link>
            {userId && (
              <Link
                href="/api/auth/sync"
                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
                target="_blank"
              >
                Sync User
              </Link>
            )}
            <Link
              href="/dashboard"
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              Go to Dashboard
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

