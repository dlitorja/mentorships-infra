# Running Database Migrations

## Option 1: Using Environment Variable (Recommended)

1. **Get your Supabase connection string:**
   - Go to Supabase Dashboard → Your Project → Settings → Database
   - Under "Connection string", copy the "URI" format
   - Format: `postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres`

2. **Set the environment variable:**
   ```bash
   export DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres"
   ```

3. **Run the migration:**
   ```bash
   pnpm run db:migrate
   ```

## Option 2: Manual SQL Execution (Alternative)

If you can't set up the connection string, you can run the migration SQL directly in Supabase:

1. Go to Supabase Dashboard → Your Project → SQL Editor
2. Copy and paste the SQL from the migration file
3. Execute it

### Migration 0004: Add Unique Constraint on session_pack_id

```sql
ALTER TABLE "seat_reservations" ADD CONSTRAINT "seat_reservations_session_pack_id_unique" UNIQUE("session_pack_id");
```

## Option 3: Using .env.local file

Create a `.env.local` file in the project root:

```env
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
```

Then run:
```bash
pnpm run db:migrate
```

## Important Notes

- **Never commit `.env.local`** - it's in `.gitignore`
- Use the **direct connection** (port 5432) for migrations, not the pooler
- The pooler (port 6543) is for application connections, not migrations
- Make sure your database password is URL-encoded if it contains special characters
