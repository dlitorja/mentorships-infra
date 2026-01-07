import postgres from "postgres";
import { readFileSync } from "fs";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres.ytxtlscmxyqomxhripki:PdD4i%2AHmyAyaEKRSxkTvua2%24lVXZtmy0@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true";

async function main() {
  console.log("Connecting to database...");
  const sql = postgres(DATABASE_URL);

  try {
    console.log("Checking for waitlist_type enum...");
    const typeCheck = await sql`SELECT typname FROM pg_type WHERE typname = 'waitlist_type'`;
    if (typeCheck.length === 0) {
      console.log("Creating waitlist_type enum...");
      await sql`CREATE TYPE "waitlist_type" AS ENUM ('one-on-one', 'group')`;
    }

    console.log("Reading migration file...");
    const migration = readFileSync("./drizzle/0013_melodic_black_widow.sql", "utf-8");

    console.log("Running migration...");
    const statements = migration.split("--> statement-breakpoint");
    
    for (const statement of statements) {
      const trimmed = statement.trim();
      if (trimmed) {
        console.log("Executing:", trimmed.substring(0, 80) + "...");
        await sql.unsafe(trimmed);
      }
    }

    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
