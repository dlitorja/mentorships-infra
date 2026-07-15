import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  isAllowedTransition,
  isValidEmail,
  normalizeEmail,
  statusLabel,
  timelineEventLabel,
  validateCommitInput,
  type OnboardingStatus,
} from "./admin-onboarding";

describe("admin-onboarding state transitions", () => {
  it("allows queued -> processing", () => {
    expect(isAllowedTransition("queued", "processing")).toBe(true);
  });

  it("allows queued -> cancelled", () => {
    expect(isAllowedTransition("queued", "cancelled")).toBe(true);
  });

  it("allows processing -> completed | failed | cancelled", () => {
    expect(isAllowedTransition("processing", "completed")).toBe(true);
    expect(isAllowedTransition("processing", "failed")).toBe(true);
    expect(isAllowedTransition("processing", "cancelled")).toBe(true);
  });

  it("allows failed -> processing | cancelled (retry path)", () => {
    expect(isAllowedTransition("failed", "processing")).toBe(true);
    expect(isAllowedTransition("failed", "cancelled")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    const illegal: Array<[OnboardingStatus, OnboardingStatus]> = [
      ["queued", "completed"],
      ["queued", "failed"],
      ["completed", "processing"],
      ["completed", "failed"],
      ["cancelled", "processing"],
      ["cancelled", "completed"],
    ];
    for (const [from, to] of illegal) {
      expect(isAllowedTransition(from, to)).toBe(false);
    }
  });

  it("cancelled and completed are terminal", () => {
    for (const from of ["cancelled", "completed"] as const) {
      expect(ALLOWED_TRANSITIONS[from]).toEqual([]);
    }
  });
});

describe("admin-onboarding email utilities", () => {
  it("normalizes whitespace and case", () => {
    expect(normalizeEmail("  Foo@Example.COM  ")).toBe("foo@example.com");
  });

  it("accepts well-formed emails", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("alice.smith@example.com")).toBe(true);
  });

  it("rejects malformed emails", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("missing@tld")).toBe(false);
    expect(isValidEmail("@example.com")).toBe(false);
    expect(isValidEmail("alice@")).toBe(false);
  });
});

describe("validateCommitInput", () => {
  const now = 1_700_000_000_000;
  const future = now + 1000 * 60 * 60 * 24 * 30;

  const baseInput = () => ({
    email: "alice@example.com",
    instructors: [
      { instructorId: "ins_1", sessionsPerInstructor: 4, expiresAt: future },
    ],
    isSeparateStudentRecord: false,
    instructorCapacities: [
      { instructorId: "ins_1", activeStudentCount: 2, maxActiveStudents: 10, exists: true, isActive: true },
    ],
    now,
  });

  it("accepts a valid input", () => {
    expect(validateCommitInput(baseInput())).toEqual([]);
  });

  it("rejects invalid email", () => {
    const errors = validateCommitInput({ ...baseInput(), email: "not-an-email" });
    expect(errors).toContain("Invalid email");
  });

  it("rejects empty instructors", () => {
    const errors = validateCommitInput({ ...baseInput(), instructors: [] });
    expect(errors).toContain("At least one instructor is required");
  });

  it("rejects sessions < 1", () => {
    const errors = validateCommitInput({
      ...baseInput(),
      instructors: [{ instructorId: "ins_1", sessionsPerInstructor: 0, expiresAt: future }],
    });
    expect(errors).toContain("Instructor ins_1: sessionsPerInstructor must be >= 1");
  });

  it("rejects past expiresAt", () => {
    const errors = validateCommitInput({
      ...baseInput(),
      instructors: [{ instructorId: "ins_1", sessionsPerInstructor: 4, expiresAt: now - 1000 }],
    });
    expect(errors).toContain("Instructor ins_1: expiresAt must be in the future");
  });

  it("rejects inactive / missing instructor", () => {
    const errors = validateCommitInput({
      ...baseInput(),
      instructorCapacities: [
        { instructorId: "ins_1", activeStudentCount: 2, maxActiveStudents: 10, exists: true, isActive: false },
      ],
    });
    expect(errors).toContain("Instructor ins_1: not found or inactive");
  });

  it("requires capacity override reason when at capacity", () => {
    const errors = validateCommitInput({
      ...baseInput(),
      instructorCapacities: [
        { instructorId: "ins_1", activeStudentCount: 10, maxActiveStudents: 10, exists: true, isActive: true },
      ],
    });
    expect(errors).toContain("Capacity override reason is required when any selected instructor is at capacity");
  });

  it("accepts capacity override when reason provided", () => {
    const errors = validateCommitInput({
      ...baseInput(),
      instructorCapacities: [
        { instructorId: "ins_1", activeStudentCount: 10, maxActiveStudents: 10, exists: true, isActive: true },
      ],
      capacityOverrideReason: "VIP escalation approved by director",
    });
    expect(errors).toEqual([]);
  });

  it("requires notes when isSeparateStudentRecord is true", () => {
    const errors = validateCommitInput({ ...baseInput(), isSeparateStudentRecord: true });
    expect(errors).toContain("Notes are required when creating a separate student record");
  });

  it("accepts isSeparateStudentRecord when notes provided", () => {
    const errors = validateCommitInput({
      ...baseInput(),
      isSeparateStudentRecord: true,
      notes: "Splitting per customer request #4421",
    });
    expect(errors).toEqual([]);
  });

  it("detects duplicate instructor ids", () => {
    const errors = validateCommitInput({
      ...baseInput(),
      instructors: [
        { instructorId: "ins_1", sessionsPerInstructor: 4, expiresAt: future },
        { instructorId: "ins_1", sessionsPerInstructor: 4, expiresAt: future },
      ],
      instructorCapacities: [
        { instructorId: "ins_1", activeStudentCount: 2, maxActiveStudents: 10, exists: true, isActive: true },
        { instructorId: "ins_1", activeStudentCount: 2, maxActiveStudents: 10, exists: true, isActive: true },
      ],
    });
    expect(errors).toContain("Duplicate instructor id: ins_1");
  });
});

describe("labels", () => {
  it("maps status to human label", () => {
    expect(statusLabel("queued")).toBe("Pending signup");
    expect(statusLabel("processing")).toBe("In progress");
    expect(statusLabel("completed")).toBe("Completed");
    expect(statusLabel("failed")).toBe("Needs attention");
    expect(statusLabel("cancelled")).toBe("Cancelled");
  });

  it("maps timeline event to human label", () => {
    expect(timelineEventLabel("email_sent")).toBe("Email sent");
    expect(timelineEventLabel("discord_queued")).toBe("Discord action queued");
    expect(timelineEventLabel("capacity_override")).toBe("Capacity override applied");
    expect(timelineEventLabel("unknown_event")).toBe("unknown_event");
  });
});
