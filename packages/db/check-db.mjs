import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres.ytxtlscmxyqomxhripki:PdD4i%2AHmyAyaEKRSxkTvua2%24lVXZtmy0@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true";

async function main() {
  console.log("Connecting to database...");
  const sql = postgres(DATABASE_URL);

  try {
    console.log("\nListing all tables...");
    const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
    console.log("Tables:", JSON.stringify(tables, null, 2));
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await sql.end();
  }
}

main();
