import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";

const getDatabaseUrl = (): string => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  return process.env.DATABASE_URL.trim();
};

const cleanConnectionString = (url: string) => url.replace(/^["']|["']$/g, "");

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

let _dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export const getDb = () => {
  if (!_dbInstance) {
    const connectionString = getDatabaseUrl();
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
  }
  return _dbInstance;
};

// Lazy-load db - only connects when actually used
export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop) {
    return getDb()[prop as keyof ReturnType<typeof getDb>];
  },
});