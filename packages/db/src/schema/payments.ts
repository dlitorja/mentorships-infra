import { pgTable, uuid, text, numeric, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { orders } from "./orders";
import { paymentProviderEnum } from "./orders";

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "completed",
  "refunded",
  "failed",
]);

export type PaymentStatus = "pending" | "completed" | "refunded" | "failed";
export type PaymentProvider = "stripe" | "paypal";

export const payments = pgTable("payments", {
  id: uuid("id")
    .primaryKey()
    .defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  provider: paymentProviderEnum("provider").notNull(),
  providerPaymentId: text("provider_payment_id").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("usd"),
  status: paymentStatusEnum("status").notNull().default("pending"),
  refundedAmount: numeric("refunded_amount", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

