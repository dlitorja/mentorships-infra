import { Check, Clock, AlertTriangle, Hourglass } from "lucide-react";

import { cn } from "@/lib/utils";
import type { OnboardingStatus } from "@/lib/admin-onboarding";

type StepState = "done" | "current" | "future" | "blocked";

const STEP_LABELS = [
  "Invitation sent",
  "Account created",
  "Workspaces ready",
  "Onboarding complete",
] as const;

/**
 * Step → which numeric step is "current" for each terminal/non-terminal
 * status. The "completed" status is split: provisioning-completed but
 * questionnaire not yet submitted → step 3 (workspaces ready). Both
 * done → step 4 (final). Greptile P2 #10.
 */
function computeCurrentStep(
  status: OnboardingStatus,
  questionnaireSubmitted: boolean
): number {
  if (status === "completed") {
    return questionnaireSubmitted ? 4 : 3;
  }
  // Exclude `completed` from the helper record — that branch is
  // handled by the early-return above. Using
  // `Exclude<OnboardingStatus, "completed">` keeps the type
  // exhaustive without a redundant key (Greptile P1 follow-up).
  const helper: Record<Exclude<OnboardingStatus, "completed">, number> = {
    queued: 1,
    processing: 2,
    failed: 2,
    cancelled: 1,
  };
  return helper[status];
}

/**
 * PR 12 PR 3 — Visual progress indicator for the student onboarding
 * status page. Read-only (the page itself is a server component).
 * Reused by the per-row status badge on `/admin/onboardings/[id]`
 * later if we want to surface the same visualization to admins; for
 * now it only renders on `/onboarding/[id]`.
 *
 * Greptile P2 #10 (PR 4b): provisioning completes asynchronously on
 * the worker, so by the time `status === "completed"` flips, the
 * student may still have an unsubmitted questionnaire. The stepper
 * should reflect "your workspaces are ready" but not mark the
 * final "Onboarding complete" step until the questionnaire is also
 * submitted (the page passes that signal in).
 */
export function OnboardingStepper({
  status,
  questionnaireSubmitted,
  className,
}: {
  status: OnboardingStatus;
  questionnaireSubmitted: boolean;
  className?: string;
}): React.JSX.Element {
  const currentStep = computeCurrentStep(status, questionnaireSubmitted);

  return (
    <ol
      className={cn("grid grid-cols-1 gap-2 sm:grid-cols-4 sm:gap-4", className)}
      aria-label="Onboarding progress"
    >
      {STEP_LABELS.map((label, idx) => {
        const stepNumber = idx + 1;
        const state = resolveState(stepNumber, currentStep, status);
        return (
          <li
            key={label}
            className={cn(
              "flex items-start gap-3 rounded-md border p-3",
              stateContainerClass(state)
            )}
          >
            <div className="mt-0.5">
              <StepIcon state={state} />
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-medium leading-none">{label}</p>
              <p className="text-xs text-muted-foreground">
                {stateDescription(state)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function resolveState(
  stepNumber: number,
  currentStep: number,
  status: OnboardingStatus
): StepState {
  if (status === "completed") {
    // Workspaces-ready is "done" once status flipped; the final
    // "Onboarding complete" step is only done once the questionnaire
    // is submitted too. `computeCurrentStep` already encodes that
    // signal — if `currentStep === 4` we know it's submitted, so
    // every step is done.
    if (currentStep >= 4) return "done";
    if (stepNumber < currentStep) return "done";
    if (stepNumber === currentStep) return "current";
    return "future";
  }
  if (status === "failed") {
    if (stepNumber < currentStep) return "done";
    if (stepNumber === currentStep) return "blocked";
    return "future";
  }
  if (status === "cancelled") {
    return stepNumber === 1 ? "blocked" : "future";
  }
  if (stepNumber < currentStep) return "done";
  if (stepNumber === currentStep) return "current";
  return "future";
}

function StepIcon({ state }: { state: StepState }): React.JSX.Element {
  const baseClass = "h-5 w-5";
  switch (state) {
    case "done":
      return <Check className={cn(baseClass, "text-emerald-600")} aria-hidden />;
    case "current":
      return <Hourglass className={cn(baseClass, "text-primary animate-pulse")} aria-hidden />;
    case "blocked":
      return <AlertTriangle className={cn(baseClass, "text-destructive")} aria-hidden />;
    case "future":
      return <Clock className={cn(baseClass, "text-muted-foreground")} aria-hidden />;
  }
}

function stateContainerClass(state: StepState): string {
  switch (state) {
    case "done":
      return "border-emerald-200 bg-emerald-50/60";
    case "current":
      return "border-primary/40 bg-primary/5";
    case "blocked":
      return "border-destructive/40 bg-destructive/5";
    case "future":
      return "border-border bg-muted/30";
  }
}

function stateDescription(state: StepState): string {
  switch (state) {
    case "done":
      return "Completed";
    case "current":
      return "In progress";
    case "blocked":
      return "Needs attention";
    case "future":
      return "Up next";
  }
}
