import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";

let _dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

const cleanConnectionString = (url: string): string => url.replace(/^["']|["']$/g, "");

const validateConnectionString = (connectionString: string): void => {
  try {
    new URL(connectionString);
  } catch {
    const preview = connectionString.substring(0, 80);
    const maskedPreview = connectionString.includes("@")
      ? preview.replace(/:[^@]+@/, ":***@")
      : preview;
    throw new Error(
      `Invalid DATABASE_URL format.\n` +
      `Received: ${maskedPreview}${connectionString.length > 80 ? "..." : ""}\n` +
      `Make sure URL starts with postgresql://`
    );
  }
};

export const getDb = () => {
  if (_dbInstance) return _dbInstance;

  // Get URL - will throw if not set (but only when actually used)
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const cleanedConnectionString = cleanConnectionString(connectionString);
  validateConnectionString(cleanedConnectionString);

  const client = postgres(cleanedConnectionString, {
    max: 10,
    onnotice: () => {},
    prepare: false,
    transform: {
      undefined: null,
    },
  });

  _dbInstance = drizzle(client, { schema });
  return _dbInstance;
};

// Lazy-load db - only connects when actually used
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    const actualDb = getDb();
    // @ts-expect-error - dynamic property access
    return actualDb[prop];
  },
});