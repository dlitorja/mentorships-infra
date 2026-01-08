import { pgTable, boolean, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const digestFrequencyEnum = pgEnum("digest_frequency", ["daily", "weekly", "monthly"]);

export const adminDigestSettings = pgTable("admin_digest_settings", {
  id: text("id").primaryKey().default("default"),
  enabled: boolean("enabled").notNull().default(true),
  frequency: digestFrequencyEnum("frequency").notNull().default("weekly"),
  adminEmail: text("admin_email").notNull(),
  lastSentAt: timestamp("last_sent_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
