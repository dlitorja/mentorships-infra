import { pgTable, uuid, text, numeric, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { paymentProviderEnum, type PaymentProvider } from "./orders";

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "completed",
  "refunded",
  "failed",
]);

// Export type for use in queries
export type PaymentStatus = "pending" | "completed" | "refunded" | "failed";

export const payments = pgTable(
  "payments",
  {
    id: text("id")
      .primaryKey(),
    convexId: text("convex_id"),
    orderId: text("order_id").notNull(),
    provider: paymentProviderEnum("provider").notNull(),
    providerPaymentId: text("provider_payment_id").notNull(),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("usd"),
    status: paymentStatusEnum("status").notNull().default("pending"),
    refundedAmount: numeric("refunded_amount", { precision: 10, scale: 2 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => ({
    orderIdIdx: index("payments_order_id_idx").on(t.orderId),
    statusIdx: index("payments_status_idx").on(t.status),
    providerPaymentIdIdx: index("payments_provider_payment_id_idx").on(t.provider, t.providerPaymentId),
  })
);

