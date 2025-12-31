import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

// Validate and clean the connection string
const connectionString = process.env.DATABASE_URL.trim();

// Remove quotes if present (some .env parsers include them)
const cleanedConnectionString = connectionString.replace(/^["']|["']$/g, "");

// Validate URL format
try {
  new URL(cleanedConnectionString);
} catch (error) {
  // Show first 80 chars for debugging (without exposing full password)
  const preview = cleanedConnectionString.substring(0, 80);
  const hasPassword = cleanedConnectionString.includes("@");
  const maskedPreview = hasPassword 
    ? preview.replace(/:[^@]+@/, ":***@") 
    : preview;
  
  throw new Error(
    `Invalid DATABASE_URL format.\n` +
    `Received: ${maskedPreview}${cleanedConnectionString.length > 80 ? "..." : ""}\n` +
    `Length: ${cleanedConnectionString.length} characters\n` +
    `Make sure:\n` +
    `- No quotes around the value in .env.local\n` +
    `- URL starts with postgresql://\n` +
    `- Format: postgresql://postgres:[password]@[host]:[port]/[database]`
  );
}

// Create the connection
// Using connection pooler URL (port 6543) which should handle IPv4/IPv6 routing
// If IPv6 errors persist in WSL2, the pooler infrastructure should handle it
// Increased max connections from 1 to 10 to improve performance and handle concurrent requests
let client: ReturnType<typeof postgres>;
try {
  client = postgres(cleanedConnectionString, { 
    max: 10, // Increased from 1 to handle concurrent requests efficiently
    onnotice: () => {}, // Suppress notices
    // Disable prepared statements for Supabase compatibility
    // Required when using connection pooling (pgbouncer)
    prepare: false,
    transform: {
      undefined: null,
    },
  });
} catch (error) {
  throw new Error(
    `Failed to create database connection: ${error instanceof Error ? error.message : String(error)}`
  );
}

// Create and export the db instance
export const db = drizzle(client, { schema });
