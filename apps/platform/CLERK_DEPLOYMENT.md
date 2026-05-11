# Clerk Deployment Guide

This guide will help you configure Clerk authentication for production deployments on Vercel.

## Problem: ERR_NAME_NOT_RESOLVED Errors

If you're seeing errors like:
- `Failed to load resource: net::ERR_NAME_NOT_RESOLVED` for `clerk.mentorships.hu` or `clerk.mentorships.huckleberry.art`
- `Clerk: Failed to load Clerk, failed to load script`
- `Clerk: Failed to load clerk (code="failed_to_load_clerk_js_timeout")`

This means Clerk is trying to load from a domain that doesn't exist or isn't configured properly.

## Solution: Configure Clerk for Production

### Step 1: Configure Clerk Dashboard

1. **Go to Clerk Dashboard** → Your Application → **Settings** → **Domains**

2. **Set Frontend API URL** (CRITICAL):
   - For Vercel deployments, use your actual Vercel deployment URL:
     - Production: `https://mentorships.vercel.app` (or your custom domain like `https://mentorships.huckleberry.art`)
     - Preview: `https://mentorships-git-<branch>.vercel.app`
   - **DO NOT** use custom subdomains like `clerk.mentorships.hu` unless you've properly configured DNS
   - **This is the most common cause of `ERR_NAME_NOT_RESOLVED` errors!**

3. **Verify the Frontend API URL**:
   - The Frontend API URL should match exactly where your app is deployed
   - If your app is at `https://mentorships.huckleberry.art`, the Frontend API URL should be `https://mentorships.huckleberry.art`
   - Clerk will automatically use this URL to load the Clerk.js script

3. **If using a custom domain**:
   - You must configure DNS records in Clerk Dashboard
   - Add the required DNS records to your domain provider
   - Wait for DNS propagation (can take up to 48 hours)

### Step 2: Set Environment Variables in Vercel

1. **Go to Vercel Dashboard** → Your Project → **Settings** → **Environment Variables**

2. **Add the following variables** for all environments (Production, Preview, Development):

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_... (or pk_test_... for preview)
CLERK_SECRET_KEY=sk_live_... (or sk_test_... for preview)
```

3. **Important Notes**:
   - Use `pk_live_` and `sk_live_` keys for production
   - Use `pk_test_` and `sk_test_` keys for preview deployments
   - Make sure `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is available to all environments
   - Make sure `CLERK_SECRET_KEY` is available to all environments

4. **After adding variables**, redeploy your application:
   ```bash
   # Trigger a new deployment
   git commit --allow-empty -m "chore: trigger redeploy for Clerk env vars"
   git push
   ```

### Step 3: Verify Clerk Configuration

1. **Check environment variables are loaded**:
   - Visit your deployment: `https://your-app.vercel.app/api/test`
   - Should show `clerk.configured: true`

2. **Test authentication**:
   - Visit: `https://your-app.vercel.app/sign-in`
   - Try signing in/up
   - Should work without domain errors

3. **Check browser console**:
   - Open DevTools → Console
   - Should NOT see `ERR_NAME_NOT_RESOLVED` errors
   - Should NOT see "Failed to load Clerk" errors

### Step 4: Using Custom Domains (Optional)

If you want to use a custom Clerk domain (e.g., `clerk.mentorships.hu`):

1. **In Clerk Dashboard**:
   - Go to **Settings** → **Domains**
   - Click **Add Custom Domain**
   - Enter your domain (e.g., `clerk.mentorships.hu`)

2. **Configure DNS Records**:
   - Clerk will provide DNS records to add
   - Add these records to your domain provider (e.g., Cloudflare, Namecheap)
   - Wait for DNS propagation (up to 48 hours)

3. **Verify Domain**:
   - Clerk will verify the domain once DNS propagates
   - Only use the custom domain after verification is complete

4. **Update Frontend API URL**:
   - In Clerk Dashboard, set Frontend API URL to your custom domain
   - Redeploy your application

## Common Issues & Solutions

### Issue: Still seeing domain errors after configuration

**Solution**:
1. Clear browser cache and hard refresh (Ctrl+Shift+R / Cmd+Shift+R)
2. Check that environment variables are set in Vercel for the correct environment
3. Verify the Frontend API URL in Clerk Dashboard matches your deployment URL
4. Redeploy the application after making changes

### Issue: Works locally but not in production

**Solution**:
1. Check that you're using production keys (`pk_live_`, `sk_live_`) in Vercel
2. Verify environment variables are set for "Production" environment in Vercel
3. Check that the Frontend API URL in Clerk Dashboard is set to your production URL

### Issue: Preview deployments not working

**Solution**:
1. Use test keys (`pk_test_`, `sk_test_`) for preview deployments
2. Set environment variables for "Preview" environment in Vercel
3. Update Frontend API URL in Clerk Dashboard to allow preview URLs (or use wildcard)

### Issue: Custom domain not resolving

**Solution**:
1. Verify DNS records are correctly added to your domain provider
2. Check DNS propagation using tools like `dig` or online DNS checkers
3. Wait up to 48 hours for DNS propagation
4. Don't use custom domain until DNS is fully propagated

## Quick Checklist

Before deploying, ensure:

- [ ] Clerk Dashboard Frontend API URL is set to your deployment URL
- [ ] Environment variables are set in Vercel for all environments
- [ ] Using correct keys (live for production, test for preview)
- [ ] Application has been redeployed after setting environment variables
- [ ] Browser console shows no Clerk loading errors
- [ ] `/api/test` endpoint shows `clerk.configured: true`

## Testing After Deployment

1. **Visit your deployment**: `https://your-app.vercel.app`
2. **Check console**: Should see no Clerk errors
3. **Test sign-in**: Visit `/sign-in` and try signing in
4. **Test sign-up**: Visit `/sign-up` and create a test account
5. **Verify redirect**: Should redirect to `/dashboard` after authentication

## Additional Resources

- [Clerk Deployment Guide](https://clerk.com/docs/guides/development/deployment/production)
- [Clerk Environment Variables](https://clerk.com/docs/references/nextjs/overview#environment-variables)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)

