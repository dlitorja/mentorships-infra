# IPv6 Connection Issue - Root Cause & Solution

## Why We've Been Having These Errors

You're experiencing a **WSL2 networking limitation**: WSL2 doesn't fully support IPv6, but Supabase's database hostname resolves to both IPv4 and IPv6 addresses. When Node.js tries to connect, it sometimes picks IPv6 first, which fails in WSL2 with `ENETUNREACH`.

## The Real Solution: Use Connection Pooler

**The best fix is to use Supabase's connection pooler URL** (port 6543) instead of the direct connection (port 5432). The pooler:
- Handles IPv4/IPv6 routing better
- Is designed for serverless/server environments
- Works more reliably in WSL2
- Is what Supabase recommends for production

## How to Fix

### Option 1: Use Connection Pooler (Recommended)

Update your `apps/web/.env.local` to use the pooler URL:

```env
# Change from direct connection (port 5432):
# DATABASE_URL=postgresql://postgres:[password]@db.ytxtlscmxyqomxhripki.supabase.co:5432/postgres

# To connection pooler (port 6543):
DATABASE_URL=postgresql://postgres.ytxtlscmxyqomxhripki:PdD4i%2AHmyAyaEKRSxkTvua2%24lVXZtmy0@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true
```

**Note**: The pooler URL format is:
- Host: `aws-0-[REGION].pooler.supabase.com` (not `db.[project-ref].supabase.co`)
- Port: `6543` (not `5432`)
- Username: `postgres.[project-ref]` (not just `postgres`)
- Query param: `?pgbouncer=true`

### Option 2: Get Pooler URL from Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to **Settings** → **Database**
3. Find **Connection string** section
4. Select **Connection pooling** tab
5. Copy the **Session mode** connection string
6. Update `DATABASE_URL` in `apps/web/.env.local`

## Why This Works

- The pooler infrastructure handles IPv4/IPv6 routing at the network level
- You don't need to force IPv4 in code
- It's the production-ready approach
- Works consistently across different environments

## After Updating

1. Restart your dev server: `pnpm dev`
2. The connection should work without IPv6 errors
3. No code changes needed - just the connection string

## Why We Tried Other Approaches

We tried:
- DNS resolution to IPv4 (didn't work reliably)
- `setDefaultAutoSelectFamily` (API issues, not the right solution)
- Various postgres-js config options

But the **real solution** is using the right connection string from the start. The pooler is designed for this exact use case.
