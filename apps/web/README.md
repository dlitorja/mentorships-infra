# Mentorship Platform Web App

Next.js App Router application for the mentorship platform.

## Authentication

Authentication is handled by Clerk with automatic user sync to Supabase.

### Middleware

The `middleware.ts` file handles:
- Route protection (requires authentication for protected routes)
- Public route access (allows unauthenticated access to public pages)
- API route protection (protects API routes except webhooks)

### Protected Routes

These routes require authentication:
- `/dashboard/*` - User dashboard
- `/sessions/*` - Session management
- `/calendar/*` - Calendar/booking interface
- `/settings/*` - User settings
- `/api/checkout/*` - Payment checkout
- `/api/sessions/*` - Session API
- `/api/orders/*` - Order API
- `/api/payments/*` - Payment API

### Public Routes

These routes are accessible without authentication:
- `/` - Home page
- `/mentors/*` - Mentor listing page
- `/about/*` - About page
- `/pricing/*` - Pricing page
- `/sign-in/*` - Sign in page
- `/sign-up/*` - Sign up page
- `/api/webhooks/*` - Webhook endpoints (Stripe, PayPal)
- `/api/health` - Health check

## Usage

### In Server Components

```typescript
import { requireAuth, getDbUser } from "@/lib/auth";

export default async function DashboardPage() {
  // Ensure user is authenticated
  const userId = await requireAuth();
  
  // Get user from database
  const user = await getDbUser();
  
  return <div>Welcome, {user.email}!</div>;
}
```

### In API Routes

```typescript
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const userId = await requireAuth();
    // Your protected API logic here
    return NextResponse.json({ userId });
  } catch (error) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }
}
```

### Role-Based Access Control

```typescript
import { requireRole } from "@/lib/auth-helpers";

export default async function AdminPage() {
  // This will redirect if user is not an admin
  const user = await requireRole("admin");
  
  return <div>Admin Dashboard</div>;
}
```

## User Sync

Users are automatically synced from Clerk to Supabase when:
1. They access a protected route for the first time
2. They call the `/api/auth/sync` endpoint

The sync process:
- Gets user data from Clerk
- Creates or updates user record in Supabase
- Uses Clerk user ID as the primary key

## Environment Variables

Required environment variables:

```env
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Database (for Drizzle)
DATABASE_URL=postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres
```

