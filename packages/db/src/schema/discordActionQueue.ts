import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { mentors } from "./mentors";
import { users } from "./users";

export const discordActionTypeEnum = pgEnum("discord_action_type", [
  "assign_mentee_role",
  "dm_instructor_new_signup",
]);

export type DiscordActionType = "assign_mentee_role" | "dm_instructor_new_signup";

export const discordActionStatusEnum = pgEnum("discord_action_status", [
  "pending",
  "processing",
  "done",
  "failed",
]);

export type DiscordActionStatus = "pending" | "processing" | "done" | "failed";

export type DiscordActionPayload = Record<string, unknown>;

export const discordActionQueue = pgTable(
  "discord_action_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: discordActionTypeEnum("type").notNull(),
    status: discordActionStatusEnum("status").notNull().default("pending"),

    // Who the action is about (mentee)
    subjectUserId: text("subject_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // Optional mentor linkage (used for instructor DM)
    mentorId: uuid("mentor_id").references(() => mentors.id, { onDelete: "set null" }),
    mentorUserId: text("mentor_user_id").references(() => users.id, { onDelete: "set null" }),

    payload: jsonb("payload").$type<DiscordActionPayload>().notNull().default({}),

    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    lockedAt: timestamp("locked_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("discord_action_queue_status_idx").on(t.status),
    subjectUserIdIdx: index("discord_action_queue_subject_user_id_idx").on(t.subjectUserId),
    mentorIdIdx: index("discord_action_queue_mentor_id_idx").on(t.mentorId),
    // Composite index for processing pending items
    statusCreatedAtIdx: index("discord_action_queue_status_created_at_idx").on(t.status, t.createdAt),
  })
);


