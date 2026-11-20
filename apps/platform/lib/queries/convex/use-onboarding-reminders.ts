import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import type { FunctionReturnType } from "convex/server";

import { api } from "@/convex/_generated/api";

/**
 * Derived from the query so the UI cannot drift from the server shape (the
 * generated types use `undefined` for absent optionals).
 */
export type OnboardingReminderPage = FunctionReturnType<
  typeof api.onboardingReminderReview.listForReview
>;
export type OnboardingReminderListItem = OnboardingReminderPage["items"][number];
export type OnboardingReminderStatus = OnboardingReminderListItem["status"];
export type OnboardingReminderKind = OnboardingReminderListItem["kind"];

export function useOnboardingReminders(
  status: OnboardingReminderStatus,
  before?: number
): UseQueryResult<OnboardingReminderPage, Error> {
  return useQuery(
    convexQuery(api.onboardingReminderReview.listForReview, {
      status,
      ...(before !== undefined ? { before } : {}),
    })
  ) as UseQueryResult<OnboardingReminderPage, Error>;
}

export function useOnboardingReminderCounts(): UseQueryResult<
  { pending: number; suppressed: number },
  Error
> {
  return useQuery(
    convexQuery(api.onboardingReminderReview.counts, {})
  ) as UseQueryResult<{ pending: number; suppressed: number }, Error>;
}
