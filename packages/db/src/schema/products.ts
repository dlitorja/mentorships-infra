import { pgTable, uuid, text, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { mentors } from "./mentors";

export const mentorshipProducts = pgTable("mentorship_products", {
  id: uuid("id")
    .primaryKey()
    .defaultRandom(),
  mentorId: uuid("mentor_id")
    .notNull()
    .references(() => mentors.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  sessionsPerPack: integer("sessions_per_pack").notNull().default(4),
  validityDays: integer("validity_days").notNull().default(30),
  stripePriceId: text("stripe_price_id"),
  paypalProductId: text("paypal_product_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Soft deletion for audit trails
  deletedAt: timestamp("deleted_at"),
});

