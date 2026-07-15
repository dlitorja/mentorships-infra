/**
 * PR admin-onboarding #1: pure helpers extracted from `convex/adminOnboarding.ts`
 * so they can be unit-tested without a Convex runtime, and so the same rules
 * can be reused from API routes and the form.
 */

export const ALLOWED_TRANSITIONS: Record<string, ReadonlyArray<string>> = {
  queued: ["processing", "cancelled"],
  processing: ["completed", "failed", "cancelled"],
  failed: ["processing", "cancelled"],
  cancelled: [],
  completed: [],
};

export const ALL_STATUSES = ["queued", "processing", "completed", "failed", "cancelled"] as const;
export type OnboardingStatus = (typeof ALL_STATUSES)[number];

export const TIMELINE_EVENTS = [
  "queued",
  "processing_started",
  "email_sent",
  "discord_queued",
  "completed",
  "failed",
  "retrying",
  "cancelled",
  "capacity_override",
  "alias_set",
] as const;
export type TimelineEvent = (typeof TIMELINE_EVENTS)[number];

export function isAllowedTransition(from: OnboardingStatus, to: OnboardingStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Pure validation for the commit mutation. Returns an array of error
 * messages; empty array means the input is valid.
 */
export function validateCommitInput(input: {
  email: string;
  instructors: Array<{
    instructorId: string;
    sessionsPerInstructor: number;
    expiresAt?: number;
  }>;
  isSeparateStudentRecord: boolean;
  notes?: string;
  capacityOverrideReason?: string;
  instructorCapacities: Array<{
    instructorId: string;
    activeStudentCount: number;
    maxActiveStudents: number | undefined;
    exists: boolean;
    isActive: boolean;
  }>;
  now: number;
}): string[] {
  const errors: string[] = [];

  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) {
    errors.push("Invalid email");
  }
  if (input.instructors.length === 0) {
    errors.push("At least one instructor is required");
  }
  if (input.isSeparateStudentRecord && !input.notes) {
    errors.push("Notes are required when creating a separate student record");
  }

  const ids = new Set<string>();
  let anyAtCapacity = false;
  for (let i = 0; i < input.instructors.length; i++) {
    const ins = input.instructors[i];
    if (ids.has(ins.instructorId)) {
      errors.push(`Duplicate instructor id: ${ins.instructorId}`);
    }
    ids.add(ins.instructorId);
    if (ins.sessionsPerInstructor < 1) {
      errors.push(`Instructor ${ins.instructorId}: sessionsPerInstructor must be >= 1`);
    }
    if (ins.expiresAt !== undefined && ins.expiresAt <= input.now) {
      errors.push(`Instructor ${ins.instructorId}: expiresAt must be in the future`);
    }

    const cap = input.instructorCapacities[i];
    if (!cap) {
      errors.push(`Instructor ${ins.instructorId}: missing capacity record`);
      continue;
    }
    if (!cap.exists || !cap.isActive) {
      errors.push(`Instructor ${ins.instructorId}: not found or inactive`);
    }
    if (typeof cap.maxActiveStudents === "number" && cap.activeStudentCount >= cap.maxActiveStudents) {
      anyAtCapacity = true;
    }
  }
  if (anyAtCapacity && !input.capacityOverrideReason) {
    errors.push("Capacity override reason is required when any selected instructor is at capacity");
  }
  return errors;
}

export function statusLabel(status: OnboardingStatus): string {
  switch (status) {
    case "queued":
      return "Pending signup";
    case "processing":
      return "In progress";
    case "completed":
      return "Completed";
    case "failed":
      return "Needs attention";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

export function timelineEventLabel(event: TimelineEvent | string): string {
  switch (event) {
    case "queued":
      return "Queued";
    case "processing_started":
      return "Processing started";
    case "email_sent":
      return "Email sent";
    case "discord_queued":
      return "Discord action queued";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "retrying":
      return "Retrying";
    case "cancelled":
      return "Cancelled";
    case "capacity_override":
      return "Capacity override applied";
    case "alias_set":
      return "Separate student alias set";
    default:
      return event;
  }
}
