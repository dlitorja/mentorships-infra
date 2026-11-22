import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({
  inngest: {
    createFunction: (
      _options: unknown,
      handler: (args: {
        step: { run: (name: string, fn: () => unknown) => unknown };
      }) => unknown
    ) => handler,
  },
}));

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
}));

const { convexServerCall } = vi.hoisted(() => ({ convexServerCall: vi.fn() }));

vi.mock("@/lib/convex-server-call", () => ({
  convexServerCall,
  ConvexServerCallError: class ConvexServerCallError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ConvexServerCallError";
      this.status = status;
    }
  },
}));

import { sendEmail } from "@/lib/email";
import { onboardingFollowUps } from "./onboarding-follow-ups";

function inlineStep() {
  return { run: (_name: string, fn: () => unknown) => fn() };
}

const INVITE = {
  onboardingId: "onb_invite",
  dedupeKey: "onboarding:onb_invite:student_invite_48h",
  kind: "student_invite_48h" as const,
  studentEmail: "invite@example.com",
  studentName: "Invite Student",
  instructorName: "Neil Gray",
  daysPending: 2,
};

const REVIEW = {
  onboardingId: "onb_review",
  submissionId: "sub_1",
  dedupeKey: "onboarding:onb_review:instructor_review_3d:inst_1",
  kind: "instructor_review_3d" as const,
  instructorId: "inst_1",
  instructorName: "Neil Gray",
  instructorEmail: "instructor@example.com",
  studentName: "Review Student",
  studentEmail: "review@example.com",
  submittedAt: Date.now() - 4 * 24 * 60 * 60 * 1000,
};

function mockBackend(scan: unknown, claimItems: unknown[] = []) {
  convexServerCall.mockImplementation(async (path: string) => {
    switch (path) {
      case "/onboarding-follow-ups/scan":
        return scan;
      case "/onboarding-follow-ups/enqueue":
        return { inserted: 1, skipped: 0 };
      case "/onboarding-follow-ups/claim":
        return { items: claimItems };
      case "/onboarding-follow-ups/mark-sent":
        return { inserted: true };
      default:
        throw new Error(`unexpected path ${path}`);
    }
  });
}

const EMPTY_SCAN = {
  studentInvites48h: [],
  studentInvites5d: [],
  adminStale7d: [],
  instructorReviews: [],
};

describe("onboardingFollowUps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    convexServerCall.mockReset();
    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendEmail).mockResolvedValue({ ok: true, id: "resend-1" } as never);
    process.env.NEXT_PUBLIC_URL = "https://dev.mentorships.example";
    process.env.ADMIN_EMAILS = "admin@example.com";
  });

  it("sends student invites without staging and reports them in a digest", async () => {
    mockBackend({ ...EMPTY_SCAN, studentInvites48h: [INVITE] });

    const result = (await (onboardingFollowUps as any)({
      step: inlineStep(),
    })) as { autoSent: number; staged: number };

    expect(result.autoSent).toBe(1);
    expect(result.staged).toBe(0);

    const sentTo = vi.mocked(sendEmail).mock.calls.map((call) => call[0].to);
    expect(sentTo).toEqual(["invite@example.com", "admin@example.com"]);

    const digest = vi.mocked(sendEmail).mock.calls.at(-1)?.[0];
    expect(digest?.subject).toMatch(/Reminders sent automatically/i);
    expect(digest?.text).toContain("invite@example.com");

    // The invite was marked sent, not queued for review.
    const marked = convexServerCall.mock.calls.filter(
      (call) => call[0] === "/onboarding-follow-ups/mark-sent"
    );
    expect(marked).toHaveLength(1);
    expect(
      convexServerCall.mock.calls.some(
        (call) => call[0] === "/onboarding-follow-ups/enqueue"
      )
    ).toBe(false);
  });

  it("stages the instructor nudge and does not email anyone directly", async () => {
    mockBackend({ ...EMPTY_SCAN, instructorReviews: [REVIEW] });

    const result = (await (onboardingFollowUps as any)({
      step: inlineStep(),
    })) as { autoSent: number; staged: number };

    expect(result.staged).toBe(1);
    expect(result.autoSent).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();

    const enqueueCall = convexServerCall.mock.calls.find(
      (call) => call[0] === "/onboarding-follow-ups/enqueue"
    );
    expect(enqueueCall).toBeDefined();
    const items = (enqueueCall?.[1] as { items: Array<{ kind: string }> }).items;
    expect(items.map((item) => item.kind)).toEqual(["instructor_review_3d"]);
  });

  it("sends no digest when there is nothing automatic", async () => {
    mockBackend(EMPTY_SCAN);

    const result = (await (onboardingFollowUps as any)({
      step: inlineStep(),
    })) as { autoSent: number; staged: number };

    expect(result.autoSent).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("onboardingFollowUps failure isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    convexServerCall.mockReset();
    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendEmail).mockResolvedValue({ ok: true, id: "resend-1" } as never);
    process.env.NEXT_PUBLIC_URL = "https://dev.mentorships.example";
    process.env.ADMIN_EMAILS = "admin@example.com";
  });

  it("keeps going when one invite is rejected", async () => {
    const secondInvite = {
      ...INVITE,
      onboardingId: "onb_invite_2",
      dedupeKey: "onboarding:onb_invite_2:student_invite_48h",
      studentEmail: "second@example.com",
      studentName: "Second Student",
    };
    mockBackend(
      {
        ...EMPTY_SCAN,
        studentInvites48h: [INVITE, secondInvite],
        instructorReviews: [REVIEW],
      }
    );
    vi.mocked(sendEmail)
      // First invite is rejected by the provider.
      .mockResolvedValueOnce({ ok: false, error: "invalid recipient" } as never)
      // Second invite goes out.
      .mockResolvedValueOnce({ ok: true, id: "resend-2" } as never)
      // Summary digest.
      .mockResolvedValueOnce({ ok: true, id: "resend-3" } as never);

    const result = (await (onboardingFollowUps as any)({
      step: inlineStep(),
    })) as { autoSent: number; failedInvites: number; staged: number };

    expect(result.failedInvites).toBe(1);
    expect(result.autoSent).toBe(1);
    // The rejected invite did not stop the gated work.
    expect(result.staged).toBe(1);

    const digest = vi.mocked(sendEmail).mock.calls.at(-1)?.[0];
    expect(digest?.subject).toMatch(/1 student email/);
    expect(digest?.text).toContain("second@example.com");
    expect(digest?.text).not.toContain("invite@example.com");
  });

  it("sends a legacy staged invite with the invite template", async () => {
    mockBackend(EMPTY_SCAN, [
      {
        dedupeKey: "onboarding:onb_legacy:student_invite_48h",
        onboardingId: "onb_legacy",
        kind: "student_invite_48h",
        recipient: "legacy@example.com",
        recipientName: "Legacy Student",
        subject: "Reminder — finish setting up your Huckleberry mentorship",
        context: JSON.stringify({
          studentName: "Legacy Student",
          instructorName: "Neil Gray",
          final: false,
        }),
      },
    ]);

    await (onboardingFollowUps as any)({ step: inlineStep() });

    const sent = vi.mocked(sendEmail).mock.calls[0][0];
    expect(sent.to).toBe("legacy@example.com");
    expect(sent.subject).toBe(
      "Reminder — finish setting up your Huckleberry mentorship"
    );
    expect(sent.subject).not.toMatch(/review/i);
  });
});
