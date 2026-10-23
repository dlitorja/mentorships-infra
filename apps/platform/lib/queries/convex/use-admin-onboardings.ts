import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { OnboardingStatus } from "@/lib/admin-onboarding";

export type { OnboardingStatus };

/**
 * One row in the `perInstructor` array on an onboarding record — written
 * by `performCommit` once per instructor and surfaced on both list and
 * detail views.
 */
export type AdminOnboardingPerInstructor = {
  instructorId: Id<"instructors">;
  isRenewal: boolean;
  sessionsPerInstructor: number;
  workspaceId?: Id<"workspaces">;
  capacityOverride?: boolean;
  /**
   * Clerk invitation id captured by the API route at commit time. Only
   * present for non-renewal pairs (renewal = existing student already
   * accepted an invite). Used by the detail page to surface the
   * invitation id for support debugging.
   */
  clerkInvitationId?: string;
};

/**
 * One entry in the append-only `timeline` array. Kept as a plain shape
 * (not a discriminated union) so the timeline UI can render any future
 * event type without a code change.
 */
export type AdminOnboardingTimelineEntry = {
  at: number;
  event: string;
  actorUserId?: string;
  details?: string;
};

/**
 * Full document shape for the admin onboarding recovery dashboard.
 * Mirrors the `adminOnboardings` Convex table; use this anywhere the
 * detail page is rendered.
 */
export type AdminOnboarding = {
  _id: Id<"adminOnboardings">;
  _creationTime: number;
  email: string;
  source: "kajabi" | "manual" | "import" | "api";
  status: OnboardingStatus;
  failureReason?: string;
  attemptCount: number;
  flowVersion: number;
  submittedByUserId: string;
  perInstructor: AdminOnboardingPerInstructor[];
  notes?: string;
  capacityOverrideReason?: string;
  isSeparateStudentRecord: boolean;
  onboardingAlias?: string;
  existingWorkspaceIds: Id<"workspaces">[];
  timeline: AdminOnboardingTimelineEntry[];
  emailsSent?: {
    student?: boolean;
    instructors?: string[];
    adminSummary?: boolean;
    stub?: boolean;
  };
  cancelledAt?: number;
  cancelledByUserId?: string;
  completedAt?: number;
  createdAt: number;
  /**
   * IANA timezone the student picked from the timezone picker. PR 14
   * addition — surfaced on the detail page so admins can spot-check
   * that the stored value looks plausible (right region, plausible
   * UTC offset) before the first session is scheduled. Optional so
   * legacy rows written before that PR remain compatible.
   */
  studentTimezone?: string;
  /** Set at the same time as `studentTimezone`; absent on legacy rows. */
  studentTimezoneSetAt?: number;
};

/**
 * Trimmed shape returned by `listAdminOnboardings` — excludes the heavy
 * `timeline` array so the list query stays cheap. Pick<> keeps this in
 * sync with `AdminOnboarding` automatically. `instructorNames` is
 * denormalized by the query (PR 11) so the list page can sort / filter /
 * display instructor names without a separate per-row query.
 */
export type AdminOnboardingListItem = Pick<
  AdminOnboarding,
  | "_id"
  | "_creationTime"
  | "email"
  | "source"
  | "status"
  | "failureReason"
  | "attemptCount"
  | "flowVersion"
  | "submittedByUserId"
  | "perInstructor"
  | "createdAt"
  | "completedAt"
  | "cancelledAt"
> & {
  instructorNames: string[];
};

/**
 * TanStack Query wrapper around `convex.adminOnboarding.listAdminOnboardings`.
 * Use from the recovery dashboard's list page (or any admin/support view).
 */
export function useListAdminOnboardings(args: {
  status?: OnboardingStatus;
  emailSearch?: string;
  instructorSearch?: string;
  limit?: number;
}): UseQueryResult<AdminOnboardingListItem[], Error> {
  return useQuery(convexQuery(api.adminOnboarding.listAdminOnboardings, args));
}

/**
 * TanStack Query wrapper around `convex.adminOnboarding.getAdminOnboarding`.
 * Pass `null` to skip the query (renders as not-yet-loaded). Returns
 * `AdminOnboarding | null` so the detail page can render an explicit
 * "not found" state when the record is gone or the caller is not
 * admin/support.
 */
export function useAdminOnboarding(
  id: Id<"adminOnboardings"> | null | undefined
): UseQueryResult<AdminOnboarding | null, Error> {
  return useQuery({
    ...convexQuery(api.adminOnboarding.getAdminOnboarding, id ? { id } : { id: "" as Id<"adminOnboardings"> }),
    enabled: !!id,
  });
}

/**
 * Submitted questionnaire answers + inspirations + active work-example
 * rows for an onboarding record. Mirrors
 * `convex.onboardingQuestionnaire.getSubmittedQuestionnaireForViewer`,
 * which is gated on the viewer being the assigned student, one of the
 * assigned instructors, or admin/support. The admin detail page passes
 * its own identity through this hook — admins/support see the row;
 * anyone else gets `null` and the page renders "Not yet submitted".
 */
export type AdminOnboardingSubmittedQuestionnaire =
  | null
  | {
      submission: {
        submittedAt: number;
        questionnaireVersion: number;
        answers: Array<{
          questionId: string;
          questionText: string;
          answerText: string;
        }>;
        inspirations: Array<{ name: string }>;
      };
      /**
       * Active-only work examples the reviewer should preview. We
       * intentionally exclude `pending` rows here (in-flight uploads)
       * because listing them on the admin detail page has caused
       * "(image)" placeholders in the past — see Greptile round-24
       * P2 #1. The full pending + active list still lives on
       * `useOnboardingWorkExamples` for surfaces that need it.
       */
      workExamples: Array<{
        _id: Id<"onboardingWorkExamples">;
        b2Key: string;
        contentType: string;
        size: number;
        uploadedAt: number;
      }>;
    };

export function useSubmittedQuestionnaire(
  onboardingId: Id<"adminOnboardings"> | null | undefined
): UseQueryResult<AdminOnboardingSubmittedQuestionnaire, Error> {
  return useQuery({
    ...convexQuery(
      (api as any).onboardingQuestionnaire.getSubmittedQuestionnaireForViewer,
      onboardingId
        ? { onboardingId }
        : { onboardingId: "" as Id<"adminOnboardings"> }
    ),
    enabled: !!onboardingId,
  });
}

/**
 * All non-deleted work-example rows for an onboarding. Same auth gate
 * as `useSubmittedQuestionnaire` (admin/support pass through). Use
 * this when a surface needs both `pending` and `active` rows (the
 * admin detail page filters to active after this resolves).
 */
export type AdminOnboardingWorkExample = {
  _id: Id<"onboardingWorkExamples">;
  status: "pending" | "active" | "deleted";
  fileName: string;
  b2Key: string;
  contentType: string;
  size: number;
  uploadedAt: number;
};

export function useOnboardingWorkExamples(
  onboardingId: Id<"adminOnboardings"> | null | undefined
): UseQueryResult<AdminOnboardingWorkExample[], Error> {
  return useQuery({
    ...convexQuery(
      (api as any).onboardingWorkExamples.listWorkExamples,
      onboardingId
        ? { onboardingId }
        : { onboardingId: "" as Id<"adminOnboardings"> }
    ),
    enabled: !!onboardingId,
  });
}

/**
 * One option row for the two-phase form's instructor multi-select. Mirrors
 * the shape returned by `getInstructorOptionsForOnboarding` so the form can
 * render capacity badges next to each instructor's name.
 */
export type InstructorOption = {
  id: Id<"instructors">;
  name: string | undefined;
  email: string | undefined;
  oneOnOneInventory: number | undefined;
  groupInventory: number | undefined;
  maxActiveStudents: number | undefined;
  activeStudentCount: number;
};

/**
 * TanStack Query wrapper around `convex.adminOnboarding.getInstructorOptionsForOnboarding`.
 * Powers the two-phase form's instructor multi-select with capacity hints.
 */
export function useInstructorOptionsForOnboarding(): UseQueryResult<InstructorOption[], Error> {
  return useQuery(convexQuery(api.adminOnboarding.getInstructorOptionsForOnboarding, {}));
}

/**
 * Lookup result that drives the existing-student banner on the two-phase
 * form. Reads the user's name, the most recent onboarding alias, and the
 * five most recent prior submissions for the email — all before Preview.
 */
export type ExistingStudentLookup = {
  exists: boolean;
  name: string | undefined;
  onboardingAlias: string | undefined;
  priorOnboardingIds: Id<"adminOnboardings">[];
};

/**
 * TanStack Query wrapper around `convex.adminOnboarding.lookupExistingStudent`.
 * Disabled until the email matches a basic RFC shape so we don't fire
 * pointless queries for partial input.
 */
export function useLookupExistingStudent(
  email: string | undefined
): UseQueryResult<ExistingStudentLookup, Error> {
  const trimmed = email?.trim().toLowerCase() ?? "";
  const enabled = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  return useQuery({
    ...convexQuery(api.adminOnboarding.lookupExistingStudent, { email: trimmed }),
    enabled,
  });
}
