# @mentorships/db

Database package for the mentorship platform. Provides Drizzle ORM schemas, Supabase clients, and Clerk integration utilities.

## Features

- ✅ Drizzle ORM schema definitions
- ✅ Supabase client utilities (server, client, middleware)
- ✅ Clerk authentication integration
- ✅ User sync from Clerk to Supabase
- ✅ Type-safe database queries

## Installation

```bash
pnpm install @mentorships/db
```

## Environment Variables

Required environment variables:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Database (for Drizzle migrations)
DATABASE_URL=postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres

# Clerk (handled by @clerk/nextjs)
CLERK_SECRET_KEY=your-secret-key
```

## Usage

### Server Components / API Routes

```typescript
import { requireAuth, getOrCreateUser } from "@mentorships/db";

// Get authenticated user ID
const userId = await requireAuth();

// Get or create user in database
const user = await getOrCreateUser();
```

### Client Components

```typescript
"use client";

import { createSupabaseBrowserClient } from "@mentorships/db";

const supabase = createSupabaseBrowserClient();
```

### Database Queries

```typescript
import { db, users } from "@mentorships/db";
import { eq } from "drizzle-orm";

// Query users
const user = await db
  .select()
  .from(users)
  .where(eq(users.id, clerkUserId))
  .limit(1);
```

### User Sync

The `getOrCreateUser()` function automatically syncs Clerk users to Supabase:

```typescript
import { getOrCreateUser } from "@mentorships/db";

// This will:
// 1. Get current Clerk user
// 2. Check if user exists in Supabase
// 3. Create or update user record
const user = await getOrCreateUser();
```

## Schema

All schema definitions are exported from `@mentorships/db`:

- `users` - User accounts (Clerk user IDs)
- `mentors` - Mentor profiles
- `mentorship_products` - Session packs for sale
- `orders` - Payment orders
- `payments` - Payment records
- `session_packs` - Purchased session packs
- `seat_reservations` - Seat management
- `sessions` - Individual mentorship sessions

## Migrations

Generate migrations:

```bash
cd packages/db
pnpm generate
```

Apply migrations (via Supabase MCP or manually):

```bash
pnpm migrate
```

## Type Safety

All database operations are fully typed with TypeScript. The schema types are automatically inferred from Drizzle schema definitions.

