import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["student", "mentor", "admin"]);

/**
 * Users table - stores Clerk user IDs as primary key
 * Clerk handles authentication, this table stores app-specific user data
 * 
 * The `id` field stores Clerk's user ID (e.g., "user_2abc123xyz")
 * Email is stored for convenience but Clerk is the source of truth for auth
 */
export const users = pgTable("users", {
  // Clerk user ID (e.g., "user_2abc123xyz")
  id: text("id").primaryKey(),
  // Email stored for convenience (Clerk is source of truth)
  email: text("email").notNull(),
  role: userRoleEnum("role").notNull().default("student"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Soft deletion for audit trails
  deletedAt: timestamp("deleted_at"),
});

