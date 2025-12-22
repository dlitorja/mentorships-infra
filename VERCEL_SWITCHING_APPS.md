# Switching Between apps/marketing and apps/web in Vercel

This guide explains how to easily switch Vercel deployments between `apps/marketing` and `apps/web`.

## Current Setup

- **Root Directory**: `apps/marketing` (configured in Vercel project settings)
- **Build Configuration**: `apps/marketing/vercel.json` handles monorepo build commands
- **GitHub Actions**: Currently builds `@mentorships/marketing` (can be updated)

## Switching to apps/web

### Step 1: Update Vercel Project Settings

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project (`mentorships-infra-web`)
3. Go to **Settings** → **General**
4. Scroll down to **Root Directory**
5. Click **Edit**
6. Change from `apps/marketing` to `apps/web` (or leave empty for root)
7. Click **Save**

### Step 2: Update Build Configuration

**Option A: Create `apps/web/vercel.json`** (Recommended for consistency)

Create `apps/web/vercel.json`:
```json
{
  "installCommand": "cd ../.. && pnpm install --frozen-lockfile",
  "buildCommand": "cd ../.. && pnpm --filter @mentorships/web build",
  "outputDirectory": ".next"
}
```

**Option B: Update root `vercel.json`**

Update the root `vercel.json`:
```json
{
  "buildCommand": "pnpm --filter @mentorships/web build",
  "installCommand": "pnpm install",
  "framework": "nextjs"
}
```

### Step 3: Update GitHub Actions (Optional)

If you want GitHub Actions to deploy `apps/web` instead:

Update `.github/workflows/deploy.yml`:
```yaml
- name: Build Web App
  run: pnpm --filter @mentorships/web build
```

### Step 4: Verify Environment Variables

Ensure all required environment variables for `apps/web` are set in Vercel:
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `DATABASE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- And any others required by `apps/web`

## Switching Back to apps/marketing

### Step 1: Update Vercel Project Settings

1. Go to **Settings** → **General** → **Root Directory**
2. Change from `apps/web` (or empty) to `apps/marketing`
3. Click **Save**

### Step 2: Verify Build Configuration

Ensure `apps/marketing/vercel.json` exists with:
```json
{
  "installCommand": "cd ../.. && pnpm install --frozen-lockfile",
  "buildCommand": "cd ../.. && pnpm --filter @mentorships/marketing build",
  "outputDirectory": ".next"
}
```

### Step 3: Update GitHub Actions (if needed)

Revert `.github/workflows/deploy.yml` to build marketing app.

## Key Points

✅ **Easy to Switch**: Just change the Root Directory in Vercel settings
✅ **No Code Changes Required**: Both apps can coexist in the repo
✅ **Separate Configurations**: Each app has its own `vercel.json` if needed
✅ **Environment Variables**: Can be different for each app (Vercel supports per-project env vars)
✅ **Domain Management**: You can point different domains to different deployments if needed

## Current Configuration Files

- **Root `vercel.json`**: Not used when Root Directory is set (has comment explaining this)
- **`apps/marketing/vercel.json`**: Active configuration for marketing app
- **`apps/web/vercel.json`**: Should be created when switching to web app

## Notes

- The Root Directory setting in Vercel takes precedence over `vercel.json` files
- Both apps can be deployed simultaneously as separate Vercel projects if needed
- Preview deployments will automatically use the correct root directory based on the branch
- Production deployments use the Root Directory setting from project settings

