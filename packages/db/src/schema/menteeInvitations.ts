import { pgTable, uuid, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { mentors } from "./mentors";

export const menteeInvitationStatusEnum = pgEnum("mentee_invitation_status", [
  "pending",
  "accepted",
  "expired",
  "cancelled",
]);

export type MenteeInvitationStatus = "pending" | "accepted" | "expired" | "cancelled";

export const menteeInvitations = pgTable(
  "mentee_invitations",
  {
    id: uuid("id")
      .primaryKey()
      .defaultRandom(),
    email: text("email").notNull(),
    instructorId: uuid("instructor_id")
      .notNull()
      .references(() => mentors.id, { onDelete: "cascade" }),
    clerkInvitationId: text("clerk_invitation_id"),
    expiresAt: timestamp("expires_at").notNull(),
    status: menteeInvitationStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index("mentee_invitations_email_idx").on(t.email),
    instructorIdIdx: index("mentee_invitations_instructor_id_idx").on(t.instructorId),
    statusIdx: index("mentee_invitations_status_idx").on(t.status),
    clerkInvitationIdIdx: index("mentee_invitations_clerk_invitation_id_idx").on(t.clerkInvitationId),
  })
);

export type MenteeInvitation = typeof menteeInvitations.$inferSelect;
export type NewMenteeInvitation = typeof menteeInvitations.$inferInsert;
