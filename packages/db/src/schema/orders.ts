import { pgTable, uuid, text, numeric, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "paid",
  "refunded",
  "failed",
  "canceled",
]);

export const paymentProviderEnum = pgEnum("payment_provider", ["stripe", "paypal"]);

// Export types for use in queries
export type OrderStatus = "pending" | "paid" | "refunded" | "failed" | "canceled";
export type PaymentProvider = "stripe" | "paypal";

export const orders = pgTable(
  "orders",
  {
    id: uuid("id")
      .primaryKey()
      .defaultRandom(),
    // References Clerk user ID from users table
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: orderStatusEnum("status").notNull().default("pending"),
    provider: paymentProviderEnum("provider").notNull(),
    totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("usd"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    // Soft deletion for audit trails (financial records)
    deletedAt: timestamp("deleted_at"),
  },
  (t) => ({
    userIdIdx: index("orders_user_id_idx").on(t.userId),
    statusIdx: index("orders_status_idx").on(t.status),
    createdAtIdx: index("orders_created_at_idx").on(t.createdAt),
    // Composite index for common query pattern: get user orders by status
    userIdStatusIdx: index("orders_user_id_status_idx").on(t.userId, t.status),
  })
);

