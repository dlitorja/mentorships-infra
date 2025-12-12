import { pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";

export const identityProviderEnum = pgEnum("identity_provider", ["discord"]);
export type IdentityProvider = "discord";

/**
 * User identities for linking 3rd-party accounts (e.g. Discord).
 *
 * - `userId` is our Clerk user id (users.id)
 * - `providerUserId` is the provider's stable user id (Discord snowflake)
 */
export const userIdentities = pgTable(
  "user_identities",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: identityProviderEnum("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    connectedAt: timestamp("connected_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userProviderUnique: uniqueIndex("user_identities_user_provider_unique").on(t.userId, t.provider),
    providerUserUnique: uniqueIndex("user_identities_provider_user_unique").on(
      t.provider,
      t.providerUserId
    ),
  })
);


