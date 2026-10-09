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
 * status. PR 4's questionnaire CTA replaces this with a finer-grained
 * mapping once the questionnaire stage lands; for PR 3 the 4-step bar
 * is the calmest read.
 */
const STEP_HELPER: Record<OnboardingStatus, number> = {
  queued: 1,
  processing: 2,
  completed: 4,
  failed: 2,
  cancelled: 1,
};

/**
 * PR 12 PR 3 — Visual progress indicator for the student onboarding
 * status page. Read-only (the page itself is a server component).
 * Reused by the per-row status badge on `/admin/onboardings/[id]`
 * later if we want to surface the same visualization to admins; for
 * now it only renders on `/onboarding/[id]`.
 */
export function OnboardingStepper({
  status,
  className,
}: {
  status: OnboardingStatus;
  className?: string;
}): React.JSX.Element {
  const currentStep = STEP_HELPER[status];

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
  // Greptile P2 finding: when `status === "completed"` the original
  // mapping marked step 4 (the final "Onboarding complete" step) as
  // "current" with a pulsing hourglass — visually unfinished. Completed
  // means every step is done.
  if (status === "completed") return "done";
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
