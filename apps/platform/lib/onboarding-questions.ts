/**
 * PR 12 PR 4 — canonical onboarding questionnaire.
 *
 * v1 ships with three questions (how-did-you-hear, goals, inspirations).
 * The text is hardcoded here (not in a DB template) because the
 * questions are general enough to apply across programs. Per-program
 * customisation is a future scope (§9 of the plan doc).
 *
 * Bump `CURRENT_VERSION` whenever any question's `label`, `type`, or
 * validation rule changes. Pure typo fixes and clarifying comments do
 * NOT count — the historical question wording is captured per-answer
 * in the `onboardingQuestionnaireSubmissions.answers` array so old
 * submissions still render correctly.
 */

export type OnboardingQuestionType = "textarea" | "inspirations";

export interface OnboardingQuestionBase {
  id: string;
  type: OnboardingQuestionType;
  label: string;
  required: boolean;
  placeholder?: string;
  helpText?: string;
}

export interface OnboardingTextareaQuestion extends OnboardingQuestionBase {
  type: "textarea";
  maxLength: number;
}

export interface OnboardingInspirationsQuestion extends OnboardingQuestionBase {
  type: "inspirations";
  minEntries: number;
  maxEntries: number;
}

export type OnboardingQuestion =
  | OnboardingTextareaQuestion
  | OnboardingInspirationsQuestion;

export const CURRENT_VERSION = 1;

export const ONBOARDING_QUESTIONS: readonly OnboardingQuestion[] = [
  {
    id: "how_did_you_hear",
    type: "textarea",
    label: "How did you learn about this mentorship?",
    required: true,
    maxLength: 2000,
    placeholder:
      "Tell us how you found us — a friend, social media, an article, anywhere.",
  },
  {
    id: "goals",
    type: "textarea",
    label: "What are your goals with art and this mentorship?",
    required: true,
    maxLength: 4000,
    placeholder:
      "What are you hoping to get out of working with your instructor?",
    helpText:
      "Your instructor reads this before your first call so they can prepare a session that's useful for you.",
  },
  {
    id: "inspirations",
    type: "inspirations",
    label: "Who are your artistic inspirations?",
    required: true,
    minEntries: 3,
    maxEntries: 4,
    helpText:
      "Add 3 or 4 artists whose work moves you. Just a name is enough — your instructor will likely know them.",
  },
] as const;
