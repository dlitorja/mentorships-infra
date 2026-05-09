import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";

let _dbInstance: PostgresJsDatabase<typeof schema> | null = null;

export const getDb = (): PostgresJsDatabase<typeof schema> => {
  // Force new connection each time to avoid cached instance issues
  _dbInstance = null;
  
  if (!_dbInstance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is required");
    }

    let cleaned = connectionString.replace(/^["']|["']$/g, "");

    // URL-decode the password if it contains encoded characters
    try {
      const parsedUrl = new URL(cleaned);
      const decodedPassword = decodeURIComponent(parsedUrl.password);
      const newUrl = `${parsedUrl.protocol}//${parsedUrl.username}:${decodedPassword}@${parsedUrl.host}${parsedUrl.pathname}${parsedUrl.search}`;
      cleaned = newUrl;
    } catch (e) {
      console.error("URL decode failed:", e);
      // If URL parsing fails, use as-is
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(cleaned);
    } catch {
      throw new Error("Invalid DATABASE_URL format");
    }

    const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const isLocalConnection =
      hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");

    // Add sslmode to query params if not present
    if (!isLocalConnection && !parsedUrl.searchParams.has("sslmode")) {
      const separator = cleaned.includes("?") ? "&" : "?";
      cleaned = `${cleaned}${separator}sslmode=require`;
    }

    const client = postgres(cleaned, {
      max: 10,
      onnotice: () => {},
      prepare: false,
      transform: {
        undefined: null,
      },
      ssl: isLocalConnection ? false : "require",
    });

    _dbInstance = drizzle(client, { schema });
  }
  return _dbInstance;
};

export const db: PostgresJsDatabase<typeof schema> = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop) {
    const database = getDb();
    return (database as PostgresJsDatabase<typeof schema>)[prop as keyof PostgresJsDatabase<typeof schema>];
  }
});