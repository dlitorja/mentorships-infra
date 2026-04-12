import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";

let _dbInstance: PostgresJsDatabase<typeof schema> | null = null;

export const getDb = (): PostgresJsDatabase<typeof schema> => {
  if (!_dbInstance) {
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

    _dbInstance = drizzle(client, { schema });
  }
  return _dbInstance;
};

// db as any to prevent TypeScript from checking types at build time
// This works because at runtime, db.select() will actually call getDb().select()
export const db: any = new Proxy({}, {
  get(_target, prop) {
    const database = getDb();
    return (database as any)[prop];
  }
});