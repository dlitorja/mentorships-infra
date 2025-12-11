import { defineConfig } from "drizzle-kit";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setDefaultResultOrder } from "node:dns";

// WSL2 often cannot reach IPv6 addresses. Prefer IPv4 when resolving db hostnames.
try {
  setDefaultResultOrder("ipv4first");
} catch {
  // ignore if not supported
}

function loadDatabaseUrlFromEnvFiles(): void {
  if (process.env.DATABASE_URL) return;

  // Try common env locations (never commit these files)
  const candidates = [
    // monorepo root
    resolve(process.cwd(), ".env.local"),
    // apps/web env (used elsewhere in this repo)
    resolve(process.cwd(), "..", "apps", "web", ".env.local"),
    resolve(process.cwd(), "..", "..", "apps", "web", ".env.local"),
  ];

  for (const p of candidates) {
    try {
      const env = readFileSync(p, "utf8");
      for (const line of env.split(/\r?\n/)) {
        const m = line.match(/^DATABASE_URL=(.*)$/);
        if (m) {
          process.env.DATABASE_URL = m[1]?.trim();
          return;
        }
      }
    } catch {
      // ignore missing/unreadable files
    }
  }
}

function isLikelyPoolerUrl(url: string): boolean {
  // Pooler URLs often include "pooler" host, port 6543, or pgbouncer=true query param.
  return /pooler\.supabase\.com/.test(url) || /:6543\b/.test(url) || /pgbouncer=true/.test(url);
}

function isWsl(): boolean {
  return Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
}

function tryDeriveDirectUrlFromPooler(poolerUrl: string): string | null {
  try {
    const u = new URL(poolerUrl);

    // Supabase pooler usernames often look like: postgres.<project_ref>
    // Example: postgres.ytxtlscmxyqomxhripki
    const username = decodeURIComponent(u.username);
    const m = username.match(/^postgres\.([a-z0-9]+)$/i);
    const projectRef = m?.[1];
    if (!projectRef) return null;

    u.hostname = `db.${projectRef}.supabase.co`;
    u.port = "5432";
    u.searchParams.delete("pgbouncer");

    return u.toString();
  } catch {
    return null;
  }
}

loadDatabaseUrlFromEnvFiles();

let databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  // Keep existing behavior, but with a clearer error message.
  // drizzle-kit will otherwise try localhost and fail with ECONNREFUSED.
  throw new Error(
    "DATABASE_URL is not set. Set DATABASE_URL (direct 5432 URL recommended for migrations)."
  );
}

if (isLikelyPoolerUrl(databaseUrl)) {
  // In WSL2, direct DB hostnames commonly resolve to IPv6-only and are unreachable.
  // Prefer using the pooler URL if that's the only reachable option.
  if (!isWsl()) {
    const derived = tryDeriveDirectUrlFromPooler(databaseUrl);
    if (!derived) {
      throw new Error(
        "DATABASE_URL appears to be a Supabase pooler/pgbouncer URL (often port 6543). For migrations, set DATABASE_URL to the direct Postgres connection string (port 5432)."
      );
    }
    databaseUrl = derived;
  }
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
  strict: true,
});

