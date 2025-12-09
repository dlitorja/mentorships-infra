// Export all schema definitions
export * from "./schema";

// Export database connection utilities
export { drizzle } from "drizzle-orm/postgres-js";
export { migrate } from "drizzle-orm/postgres-js/migrator";
export type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

// Export Supabase clients
export { createClient as createSupabaseClient } from "./lib/supabase/server";
export { createClient as createSupabaseBrowserClient } from "./lib/supabase/client";
export { createClient as createSupabaseMiddlewareClient } from "./lib/supabase/middleware";

// Export Clerk utilities
export {
  getClerkUserId,
  getClerkUser,
  requireAuth,
  syncClerkUserToSupabase,
  getOrCreateUser,
} from "./lib/clerk";

// Export Drizzle database instance
export { db } from "./lib/drizzle";

// Export query helpers
export * from "./lib/queries/users";
export * from "./lib/queries/orders";
export * from "./lib/queries/payments";
export * from "./lib/queries/sessionPacks";
export * from "./lib/queries/sessions";
export * from "./lib/queries/products";
export * from "./lib/queries/discounts";
export * from "./lib/queries/bookingValidation";
export * from "./lib/queries/seatReservations";

// Export types
export type { Database } from "./types/database.types";
