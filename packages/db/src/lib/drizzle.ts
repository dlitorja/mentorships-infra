import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";
import dns from "dns";

// Force IPv4 resolution - must be set before any DNS lookups
// This tells Node.js to prefer IPv4 addresses when resolving hostnames
if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

// Get connection string - check at runtime, not module load time
function getConnectionString(): string {
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is required. " +
      "Make sure it's set in apps/web/.env.local and restart your dev server."
    );
  }

  // Validate connection string format
  if (!connectionString.startsWith("postgresql://") && !connectionString.startsWith("postgres://")) {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection string");
  }

  return connectionString;
}

// Create client lazily - only when first accessed
let clientInstance: ReturnType<typeof postgres> | null = null;

function getClient() {
  if (!clientInstance) {
    const connectionString = getConnectionString();
    const isPoolerHost = connectionString.includes("pooler.supabase.com");

    clientInstance = postgres(connectionString, {
      ssl: { rejectUnauthorized: false },
      max: 1,
      // Timeout settings - use reasonable defaults
      connect_timeout: 10, // 10 seconds for connection
      idle_timeout: 20, // 20 seconds for idle connections
      // Disable prepared statements for ALL pooler connections per Supabase docs
      prepare: !isPoolerHost, // false for all poolers, true for direct (if ever used)
    });
  }
  
  return clientInstance;
}

// Create db instance lazily
let dbInstance: ReturnType<typeof drizzle> | null = null;

function getDb() {
  if (!dbInstance) {
    dbInstance = drizzle(getClient(), { schema });
  }
  return dbInstance;
}

// Export db - initialize directly
// Lazy client initialization ensures env vars are loaded before connection
export const db = drizzle(getClient(), { schema });

