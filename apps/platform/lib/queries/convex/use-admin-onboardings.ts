import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type OnboardingStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export type AdminOnboardingListItem = {
  _id: Id<"adminOnboardings">;
  _creationTime: number;
  email: string;
  source: "kajabi" | "manual" | "import" | "api";
  status: OnboardingStatus;
  failureReason?: string;
  attemptCount: number;
  flowVersion: number;
  submittedByUserId: string;
  perInstructor: Array<{
    instructorId: Id<"instructors">;
    isRenewal: boolean;
    sessionsPerInstructor: number;
    workspaceId?: Id<"workspaces">;
    capacityOverride?: boolean;
  }>;
  createdAt: number;
  completedAt?: number;
  cancelledAt?: number;
};

export function useListAdminOnboardings(args: {
  status?: OnboardingStatus;
  emailSearch?: string;
  limit?: number;
}): UseQueryResult<AdminOnboardingListItem[], Error> {
  return useQuery(convexQuery(api.adminOnboarding.listAdminOnboardings, args));
}

export function useAdminOnboarding(
  id: Id<"adminOnboardings"> | null | undefined
): UseQueryResult<AdminOnboardingListItem | null, Error> {
  return useQuery({
    ...convexQuery(api.adminOnboarding.getAdminOnboarding, id ? { id } : { id: "" as Id<"adminOnboardings"> }),
    enabled: !!id,
  });
}
