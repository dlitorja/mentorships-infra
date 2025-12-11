# DATABASE_URL Setup for huckleberry-mentorships

## Project Information

- **Project Name**: huckleberry-mentorships
- **Project Ref**: `ytxtlscmxyqomxhripki`
- **Database Host**: `db.ytxtlscmxyqomxhripki.supabase.co`
- **Region**: us-west-2

## How to Get Your Database Password

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project: **huckleberry-mentorships**
3. Go to **Settings** → **Database**
4. Scroll down to **Connection string** section
5. Under **URI**, you'll see the connection string with your password
6. Copy the connection string

## DATABASE_URL Format

The connection string format is:

```
postgresql://postgres:[YOUR_PASSWORD]@db.ytxtlscmxyqomxhripki.supabase.co:5432/postgres
```

### For Direct Connection (Migrations)
```
postgresql://postgres:[YOUR_PASSWORD]@db.ytxtlscmxyqomxhripki.supabase.co:5432/postgres
```

### For Connection Pooling (Application)
```
postgresql://postgres.ytxtlscmxyqomxhripki:[YOUR_PASSWORD]@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true
```

**Note**: Use the **direct connection** (port 5432) for migrations, and the **pooler** (port 6543) for application connections.

## Adding to .env.local

1. Create or edit `.env.local` in the project root:
   ```bash
   # From project root
   touch .env.local
   ```

2. Add the DATABASE_URL:
   ```env
   DATABASE_URL=postgresql://postgres:[YOUR_PASSWORD]@db.ytxtlscmxyqomxhripki.supabase.co:5432/postgres
   ```

3. Replace `[YOUR_PASSWORD]` with your actual database password from Supabase Dashboard

## Security Notes

- ✅ `.env.local` is already in `.gitignore` - it won't be committed
- ⚠️ Never commit database passwords to git
- ⚠️ If your password contains special characters, URL-encode them:
  - `@` becomes `%40`
  - `#` becomes `%23`
  - `%` becomes `%25`
  - etc.

## Testing the Connection

After setting DATABASE_URL, test it:

```bash
pnpm run db:migrate
```

If it works, you'll see migrations being applied (or "No migrations to apply" if already up to date).
