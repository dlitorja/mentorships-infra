# Monorepo Setup for Next.js

This app is part of a pnpm monorepo. Here's how to run it correctly.

## Running the Dev Server

### Option 1: From Root (Recommended)
```bash
# From the root of the monorepo
pnpm dev
# or
pnpm dev:turbo  # with Turbopack
```

### Option 2: From apps/web Directory
```bash
cd apps/web
pnpm dev
# or without Turbopack if you encounter issues
pnpm dev:no-turbo
```

## Troubleshooting

### "Couldn't find the Next.js package" Error

If you see this error, try:

1. **Run from the correct directory:**
   ```bash
   # Make sure you're in apps/web or the root
   cd apps/web
   pnpm dev:no-turbo
   ```

2. **Reinstall dependencies:**
   ```bash
   # From root
   pnpm install
   ```

3. **Clear Next.js cache:**
   ```bash
   cd apps/web
   rm -rf .next
   pnpm dev
   ```

4. **If Turbopack issues persist, use regular dev mode:**
   ```bash
   cd apps/web
   pnpm dev:no-turbo
   ```

## Package Structure

- `apps/web/package.json` - Web app dependencies
- Root `package.json` - Shared dependencies (hoisted by pnpm)
- `packages/db/package.json` - Database package

All dependencies are managed by pnpm workspaces and hoisted to the root `node_modules`.

