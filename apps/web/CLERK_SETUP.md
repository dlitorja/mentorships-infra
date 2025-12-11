# Clerk Setup Guide

This guide will help you set up Clerk authentication for the mentorship platform.

## Step 1: Create a Clerk Account

1. Go to [https://clerk.com](https://clerk.com)
2. Sign up for a free account
3. Create a new application
4. Choose "Next.js" as your framework

## Step 2: Get Your Clerk Keys

1. In the Clerk Dashboard, go to **API Keys**
2. Copy the following keys:
   - **Publishable Key** (starts with `pk_test_` or `pk_live_`)
   - **Secret Key** (starts with `sk_test_` or `sk_live_`)

## Step 3: Configure Environment Variables

Create a `.env.local` file in `apps/web/` with the following:

```env
# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
CLERK_SECRET_KEY=sk_test_your_secret_key_here

# Optional: Custom URLs (these are the defaults)
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard

# Supabase (if not already configured)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Database (for Drizzle ORM)
DATABASE_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
```

## Step 4: Configure Clerk Application Settings

In the Clerk Dashboard:

1. **Authentication Methods**: Enable the methods you want (Email, Google, etc.)
2. **User Management**: Configure user settings as needed
3. **Appearance**: Customize the sign-in/sign-up UI (optional)

## Step 5: Test the Setup

1. Start your development server:
   ```bash
   cd apps/web
   pnpm dev
   ```

2. Navigate to `http://localhost:3000`
3. Click "Sign Up" to create a test account
4. After signing up, you should be redirected to `/dashboard`
5. The user should be automatically synced to Supabase

## Features Included

✅ **Sign In Page** (`/sign-in`) - Clerk's pre-built sign-in component  
✅ **Sign Up Page** (`/sign-up`) - Clerk's pre-built sign-up component  
✅ **Protected Routes** - Middleware automatically protects routes  
✅ **User Sync** - Users are automatically synced to Supabase  
✅ **User Button** - Clerk's user profile button component  
✅ **Dashboard** - Example protected page  

## Routes

- `/` - Home page (public)
- `/sign-in` - Sign in page (public)
- `/sign-up` - Sign up page (public)
- `/dashboard` - User dashboard (protected)
- `/sessions/*` - Session management (protected)
- `/calendar/*` - Calendar/booking (protected)
- `/settings/*` - User settings (protected)

## Troubleshooting

### "Clerk: Missing publishableKey"

Make sure `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is set in your `.env.local` file and restart your dev server.

### ERR_NAME_NOT_RESOLVED Errors (Deployment Issues)

If you're seeing errors like `Failed to load resource: net::ERR_NAME_NOT_RESOLVED` for Clerk domains, this is a deployment configuration issue. See `CLERK_DEPLOYMENT.md` for detailed instructions.

**Quick fixes**:
1. Check that environment variables are set in Vercel
2. Verify Frontend API URL in Clerk Dashboard matches your deployment URL
3. Redeploy after making changes

### Network Error: "network error" on session tokens

If you see a console error like `[Clerk Debug] ERROR [fapiClient]: network error {"error":{},"url":"https://...clerk.accounts.dev/v1/client/sessions/.../tokens","method":"POST"}`, this indicates a network connectivity issue when Clerk tries to fetch session tokens.

**Common causes and solutions:**

1. **Temporary network issue**: 
   - Clerk will automatically retry the request
   - This is usually non-blocking and authentication will work once the network request succeeds
   - Try refreshing the page

2. **Firewall or network blocking**:
   - Check if your network/firewall is blocking requests to `*.clerk.accounts.dev`
   - Try from a different network (e.g., mobile hotspot) to verify
   - Whitelist Clerk domains if using corporate firewall

3. **Turbopack compatibility (Next.js 16)** ⚠️ **CONFIRMED ISSUE**:
   - **Next.js 16 uses Turbopack by default, which has known compatibility issues with Clerk**
   - There are documented GitHub issues:
     - [Clerk Issue #1257](https://github.com/clerk/javascript/issues/1257): "Error when using Next.js turbo" - `Cannot find module '#crypto'` errors
     - [Next.js Issue #70424](https://github.com/vercel/next.js/issues/70424): Turbopack + Clerk + HMR causes module instantiation problems
   - **Solution**: Run without Turbopack: `pnpm dev:no-turbo` instead of `pnpm dev`
   - **Permanent fix**: Update your `package.json` dev script to use webpack:
     ```json
     "dev": "next dev",
     "dev:turbo": "next dev --turbo"
     ```
   - This is a known limitation and many developers are disabling Turbopack when using Clerk

4. **Environment variables**:
   - Verify `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is set correctly
   - Restart the dev server after changing environment variables
   - Check that the key matches your Clerk application

5. **Browser extensions**:
   - Disable ad blockers or privacy extensions that might block Clerk requests
   - Try in an incognito/private window

6. **Clerk API status**:
   - Check [Clerk Status](https://status.clerk.com) for any service outages
   - Wait a few minutes and try again

**Note**: This error is often non-blocking. If authentication still works (you can sign in/out), you can safely ignore this debug log. Clerk will retry the request automatically.

### 422 Error: "request failed" on sign-up

If you see a console error like `[Clerk Debug] ERROR [fapiClient]: request failed {"method":"POST","path":"/client/sign_ups","status":422}`, this is typically a validation error. Common causes:

1. **Email already exists**: The email you're using is already registered. Try signing in instead of signing up.
2. **Invalid email format**: Ensure you're using a valid email address.
3. **Missing required fields**: Make sure all required fields are filled in.

**Note**: This console error is usually non-blocking. Clerk's UI component will display the actual error message to the user. If you can still complete sign-up/sign-in successfully, you can ignore this debug log.

### Users not syncing to Supabase

1. Check that `DATABASE_URL` is set correctly
2. Verify Supabase connection in `packages/db`
3. Check browser console and server logs for errors
4. Try calling `/api/auth/sync` manually after signing in

### Middleware not working

1. Ensure `middleware.ts` is in the root of `apps/web/`
2. Check that `@clerk/nextjs` is installed
3. Verify environment variables are loaded correctly

## Next Steps

1. Customize the sign-in/sign-up appearance in Clerk Dashboard
2. Add social login providers (Google, GitHub, etc.)
3. Configure user metadata for roles (student, mentor, admin)
4. Set up email templates in Clerk Dashboard

