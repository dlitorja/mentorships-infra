import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { waitlistTypeEnum } from "./waitlist";

export const kajabiOffers = pgTable("kajabi_offers", {
  id: text("id").primaryKey(), // Kajabi offer ID
  instructorSlug: text("instructor_slug").notNull(),
  type: waitlistTypeEnum("type").notNull(), // "one-on-one" | "group"
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  instructorIndex: index("kajabi_offers_instructor_slug_idx").on(table.instructorSlug),
  typeIndex: index("kajabi_offers_type_idx").on(table.type),
}));

export const kajabiOffersRelations = relations(kajabiOffers, ({}) => ({}));
