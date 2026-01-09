import postgres from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDatabaseUrlFromEnvFiles(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const candidates = [
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), "..", "apps", "web", ".env.local"),
    resolve(process.cwd(), "..", "..", "apps", "web", ".env.local"),
  ];

  for (const p of candidates) {
    try {
      const env = readFileSync(p, "utf8");
      for (const line of env.split(/\r?\n/)) {
        const m = line.match(/^DATABASE_URL=(.*)$/);
        if (m) {
          let value = m[1]?.trim() || "";
          value = value.replace(/^["']|["']$/g, "");
          return value;
        }
      }
    } catch {
      // ignore
    }
  }
}

const sqlUrl = loadDatabaseUrlFromEnvFiles();

if (!sqlUrl) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const sql = postgres(sqlUrl);

async function applyMigration() {
  try {
    const migrationSQL = readFileSync(
      new URL("../drizzle/0015_admin_digest_settings.sql", import.meta.url),
      "utf-8"
    );

    await sql.unsafe(migrationSQL);
    console.log("✅ Migration 0015 applied successfully");

    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'admin_digest_settings'
    `;

    if (tables.length > 0) {
      console.log("✅ admin_digest_settings table verified");
    } else {
      console.log("❌ admin_digest_settings table not found");
    }
  } catch (error) {
    console.error("Error applying migration:", error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

applyMigration();
