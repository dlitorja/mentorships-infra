import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";

let _dbInstance: PostgresJsDatabase<typeof schema> | null = null;
let _client: ReturnType<typeof postgres> | null = null;
let _cachedConnectionString: string | null = null;

export const getDb = (): PostgresJsDatabase<typeof schema> => {
  const connectionString = process.env.DATABASE_URL;

  if (_dbInstance && _cachedConnectionString === connectionString) {
    return _dbInstance;
  }

  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  let cleaned = connectionString.replace(/^["']|["']$/g, "");

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(cleaned);
  } catch {
    throw new Error("Invalid DATABASE_URL format");
  }

  try {
    parsedUrl.password = decodeURIComponent(parsedUrl.password);
    cleaned = parsedUrl.toString();
  } catch {
    // If normalization fails, continue with original cleaned URL
  }

  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isLocalConnection =
    hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");

  if (!isLocalConnection && !parsedUrl.searchParams.has("sslmode")) {
    const separator = cleaned.includes("?") ? "&" : "?";
    cleaned = `${cleaned}${separator}sslmode=require`;
  }

  const nextClient = postgres(cleaned, {
    max: 10,
    onnotice: () => {},
    prepare: false,
    transform: {
      undefined: null,
    },
    ssl: isLocalConnection ? false : "require",
  });

  const nextDb = drizzle(nextClient, { schema });

  if (_client) {
    void _client.end({ timeout: 5 }).catch(() => {});
  }
  _client = nextClient;
  _dbInstance = nextDb;
  _cachedConnectionString = connectionString;
  return _dbInstance;
};

export const db: PostgresJsDatabase<typeof schema> = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop) {
    const database = getDb();
    return (database as PostgresJsDatabase<typeof schema>)[prop as keyof PostgresJsDatabase<typeof schema>];
  }
});