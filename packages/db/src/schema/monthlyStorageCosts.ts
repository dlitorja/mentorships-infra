import { pgTable, text, timestamp, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";

export const monthlyStorageCosts = pgTable(
  "monthly_storage_costs",
  {
    id: text("id").primaryKey(),
    month: text("month").notNull(),

    b2StorageCost: integer("b2_storage_cost").notNull().default(0),
    b2DownloadCost: integer("b2_download_cost").notNull().default(0),
    b2ApiCost: integer("b2_api_cost").notNull().default(0),

    s3StorageCost: integer("s3_storage_cost").notNull().default(0),
    s3RetrievalCost: integer("s3_retrieval_cost").notNull().default(0),

    totalCost: integer("total_cost").notNull().default(0),

    alertSent: boolean("alert_sent").default(false),
    alertThreshold: integer("alert_threshold").default(5000),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    monthIdx: uniqueIndex("monthly_storage_costs_month_idx").on(t.month),
  })
);

export type MonthlyStorageCost = typeof monthlyStorageCosts.$inferSelect;
export type NewMonthlyStorageCost = typeof monthlyStorageCosts.$inferInsert;
