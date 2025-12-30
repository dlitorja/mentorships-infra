# Fix DATABASE_URL Error

## The Problem
The error `Invalid URL` occurs because:
1. Quotes are included in the DATABASE_URL value
2. Or the .env.local file is in the wrong location

## Solution

### Step 1: Locate/Create .env.local

For a Next.js monorepo, `.env.local` should be in **`apps/web/`** directory:

```bash
# Create .env.local in apps/web/
cd apps/web
touch .env.local
```

### Step 2: Add DATABASE_URL (NO QUOTES)

Open `apps/web/.env.local` and add:

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.ytxtlscmxyqomxhripki.supabase.co:5432/postgres
```

**Note**: Replace `YOUR_PASSWORD` with your actual Supabase database password. URL-encode special characters if needed (e.g., `@` becomes `%40`, `$` becomes `%24`).

**Important**: 
- ❌ NO quotes around the value
- ✅ Just the connection string directly

### Step 3: Restart Dev Server

After updating .env.local:
```bash
# Stop the current dev server (Ctrl+C)
# Then restart:
pnpm dev
```

## Verification

The updated code in `packages/db/src/lib/drizzle.ts` will now:
- ✅ Strip quotes if present
- ✅ Validate the URL format
- ✅ Show a helpful error message if still invalid

## Alternative: Root .env.local

If you prefer to have `.env.local` in the project root, Next.js will also read it, but `apps/web/.env.local` takes precedence.
