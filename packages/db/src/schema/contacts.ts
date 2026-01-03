import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  artGoals: text("art_goals"),
  source: text("source").default("matching_form"),
  optedIn: boolean("opted_in").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
