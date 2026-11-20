import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type OnboardingReminderStatus =
  | "pending_review"
  | "approved"
  | "sent"
  | "suppressed";

export type OnboardingReminderKind =
  | "student_invite_48h"
  | "student_invite_5d"
  | "admin_stale_7d"
  | "instructor_review_3d";

export type OnboardingReminderListItem = {
  _id: Id<"onboardingReminders">;
  dedupeKey: string;
  kind: OnboardingReminderKind;
  onboardingId: Id<"adminOnboardings">;
  recipient: string;
  recipientName?: string;
  recipientKind?: "student" | "instructor" | "admin";
  subject?: string;
  previewText?: string;
  reason?: string;
  status: OnboardingReminderStatus;
  createdAt: number;
  sentAt?: number;
  reviewedAt?: number;
  suppressReason?: string;
};

export type OnboardingReminderPage = {
  items: OnboardingReminderListItem[];
  nextCursor?: number;
};

export function useOnboardingReminders(
  status: OnboardingReminderStatus,
  before?: number
): UseQueryResult<OnboardingReminderPage, Error> {
  return useQuery(
    convexQuery(api.onboardingReminderReview.listForReview, {
      status,
      ...(before !== undefined ? { before } : {}),
    })
  );
}

export function useOnboardingReminderCounts(): UseQueryResult<
  { pending: number; suppressed: number },
  Error
> {
  return useQuery(convexQuery(api.onboardingReminderReview.counts, {}));
}
