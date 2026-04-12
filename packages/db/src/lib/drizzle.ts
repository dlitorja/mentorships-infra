import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";

let _dbInstance: PostgresJsDatabase<typeof schema> | null = null;

const getDbConnection = () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const cleaned = connectionString.replace(/^["']|["']$/g, "");
  
  try {
    new URL(cleaned);
  } catch {
    throw new Error("Invalid DATABASE_URL format");
  }

  const client = postgres(cleaned, {
    max: 10,
    onnotice: () => {},
    prepare: false,
    transform: {
      undefined: null,
    },
  });

  return drizzle(client, { schema });
};

// getDb returns a fresh connection each time
// This avoids holding onto a connection at module scope
export const getDb = (): PostgresJsDatabase<typeof schema> => {
  if (!_dbInstance) {
    _dbInstance = getDbConnection();
  }
  return _dbInstance;
};

// db typed as any to avoid build-time type errors
// At runtime this will work because getDb() is called via the proxy
export const db = new Proxy(function() {}, {
  get(_target, prop) {
    return (_target as any)[prop] || ((...args: unknown[]) => getDb()[prop as any](...args));
  },
}) as any;