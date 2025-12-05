import { pgTable, uuid, text, numeric, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "paid",
  "refunded",
  "failed",
  "canceled",
]);

export const paymentProviderEnum = pgEnum("payment_provider", ["stripe", "paypal"]);

export const orders = pgTable("orders", {
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
});

