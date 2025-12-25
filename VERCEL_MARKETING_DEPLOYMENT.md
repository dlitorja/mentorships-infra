# Vercel Marketing Site Deployment Guide

This guide explains how to configure Vercel to deploy `apps/marketing` instead of `apps/web`, and set up the domain `mentorships.huckleberry.art`.

## Changes Made

1. **Created `vercel.json`** in the root directory to specify `apps/marketing` as the root directory
2. **Updated GitHub Actions workflow** to build the marketing app instead of the web app

## Step 1: Configure Vercel Project Settings (CRITICAL)

**You MUST configure the Root Directory in Vercel project settings. This is the primary way to switch from `apps/web` to `apps/marketing`.**

### Using Vercel Dashboard (Recommended)

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. Go to **Settings** → **General**
4. Scroll down to **Root Directory**
5. Click **Edit**
6. Set the root directory to: `apps/marketing`
7. Click **Save**

**Important**: After changing the root directory, Vercel will automatically trigger a new deployment. The `vercel.json` file we created will help with build configuration, but the Root Directory setting is what actually tells Vercel which app to deploy.

### Alternative: Using Vercel CLI

If you prefer CLI:
```bash
# Link to the project
vercel link

# Or deploy directly from the marketing directory
cd apps/marketing
vercel --prod
```

**Note**: The `vercel.json` file in the root provides build configuration, but the Root Directory setting in Vercel project settings takes precedence and is the recommended approach for monorepos.

## Step 2: Add Domain to Vercel Project

1. Go to your Vercel project → **Settings** → **Domains**
2. Click **Add Domain**
3. Enter: `mentorships.huckleberry.art`
4. Click **Add**

## Step 3: Configure DNS Records

Vercel will provide DNS records to add. You'll need to add these to your DNS provider (likely Cloudflare):

### DNS Records to Add:

1. **A Record** (if using apex domain):
   - Name: `@` or `mentorships`
   - Type: `A`
   - Value: `76.76.21.21` (Vercel's IP - check Vercel dashboard for current IP)

2. **CNAME Record** (recommended for subdomain):
   - Name: `mentorships`
   - Type: `CNAME`
   - Value: `cname.vercel-dns.com` (or the value Vercel provides)

**Note**: Vercel will show you the exact DNS records needed in the domain settings page.

## Step 4: Set Up Cloudflare Redirect

After the domain is working, set up a redirect from the old Kajabi page to the new domain:

1. Go to Cloudflare Dashboard
2. Select your domain (`huckleberry.art`)
3. Go to **Rules** → **Redirect Rules** (or **Page Rules** if Redirect Rules aren't available)
4. Create a new redirect rule:
   - **URL Pattern**: `https://home.huckleberry.art/mentorships*`
   - **Destination**: `https://mentorships.huckleberry.art$1`
   - **Status Code**: `301` (Permanent Redirect)
   - **Preserve Query String**: Yes

### Alternative: Using Cloudflare Workers (More Flexible)

If you need more control, you can create a Cloudflare Worker:

```javascript
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  
  // Redirect /mentorships paths to new domain
  if (url.pathname.startsWith('/mentorships')) {
    const newUrl = `https://mentorships.huckleberry.art${url.pathname}${url.search}`
    return Response.redirect(newUrl, 301)
  }
  
  // Otherwise, pass through to Kajabi
  return fetch(request)
}
```

## Step 5: Verify Deployment

1. Push your changes to the `main` branch
2. The GitHub Actions workflow will automatically deploy
3. Check Vercel dashboard for deployment status
4. Visit `https://mentorships.huckleberry.art` to verify it's working

## Troubleshooting

### Build Fails

- Check that `apps/marketing` has all required dependencies
- Verify `next.config.ts` is properly configured
- Check Vercel build logs for specific errors

### Domain Not Working

- Verify DNS records are correctly set (can take up to 48 hours to propagate)
- Check Vercel domain settings show the domain as "Valid"
- Ensure SSL certificate is issued (automatic, but may take a few minutes)

### Redirect Not Working

- Verify Cloudflare rule is active
- Check that the URL pattern matches exactly
- Test with curl: `curl -I https://home.huckleberry.art/mentorships`

## Reverting to apps/web

If you need to switch back to `apps/web`:

1. Update `vercel.json` to set `rootDirectory` to `apps/web`
2. Update GitHub Actions workflow to build `@mentorships/web`
3. Update Vercel project settings root directory back to `apps/web`

## Notes

- The marketing site doesn't require environment variables (no Clerk, Stripe, Supabase)
- The marketing site already has redirects configured for legacy routes (see `apps/marketing/next.config.ts`)
- Both apps can coexist - you can create a separate Vercel project for `apps/web` if needed

