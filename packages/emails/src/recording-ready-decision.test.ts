import { describe, expect, it } from "vitest";
import {
  decideRecordingReadyEmailOutcome,
  type RecipientInfo,
} from "./recording-ready-decision";

const baseRecipient: RecipientInfo = {
  email: "ada@example.com",
  firstName: "Ada",
  instructorName: "Sarah Lee",
  recordingReadyEmail: true,
  sessionId: "se_xyz",
  workspaceId: "ws_abc",
};

describe("decideRecordingReadyEmailOutcome", () => {
  describe("opted_out branch", () => {
    it("returns opted_out when recordingReadyEmail preference is false", () => {
      const decision = decideRecordingReadyEmailOutcome({
        recipient: { ...baseRecipient, recordingReadyEmail: false },
      });

      expect(decision.outcome).toBe("opted_out");
      expect(decision.reason).toBe("preference-disabled");
      expect(decision.providerEmailId).toBe("opted_out");
      expect(decision.sideEffect).toEqual({
        kind: "mark-sent",
        providerEmailId: "opted_out",
      });
    });

    it("does NOT send or call sendResult for opted-out recipients", () => {
      // sendResult is intentionally set; the preference guard must
      // short-circuit BEFORE reading it.
      const decision = decideRecordingReadyEmailOutcome({
        recipient: { ...baseRecipient, recordingReadyEmail: false },
        sendResult: { ok: true, id: "re_xxx" },
      });

      expect(decision.outcome).toBe("opted_out");
      expect(decision.providerEmailId).toBe("opted_out");
    });
  });

  describe("no_email branch", () => {
    it("returns no_email when recipient has no email", () => {
      const decision = decideRecordingReadyEmailOutcome({
        recipient: { ...baseRecipient, email: null },
      });

      expect(decision.outcome).toBe("no_email");
      expect(decision.reason).toBe("missing-user-email");
      expect(decision.providerEmailId).toBe("no_email");
      expect(decision.sideEffect).toEqual({
        kind: "mark-sent",
        providerEmailId: "no_email",
      });
    });

    it("preference check still wins over no_email", () => {
      const decision = decideRecordingReadyEmailOutcome({
        recipient: {
          ...baseRecipient,
          recordingReadyEmail: false,
          email: null,
        },
      });

      expect(decision.outcome).toBe("opted_out");
    });
  });

  describe("failed (missing-workspace-id) branch", () => {
    it("returns failed when workspaceId is null", () => {
      const decision = decideRecordingReadyEmailOutcome({
        recipient: { ...baseRecipient, workspaceId: null },
      });

      expect(decision.outcome).toBe("failed");
      expect(decision.reason).toBe("missing-workspace-id");
      expect(decision.providerEmailId).toBe("");
      expect(decision.sideEffect).toEqual({
        kind: "mark-failed",
        deliveryError: "resend:missing-workspace-id",
      });
    });
  });

  describe("failed (missing-send-result) branch", () => {
    it("returns failed when caller forgets to invoke sendEmail", () => {
      const decision = decideRecordingReadyEmailOutcome({
        recipient: baseRecipient,
        // sendResult omitted
      });

      expect(decision.outcome).toBe("failed");
      expect(decision.reason).toBe("missing-send-result");
      expect(decision.providerEmailId).toBe("");
      expect(decision.sideEffect).toEqual({
        kind: "mark-failed",
        deliveryError: "resend:missing-send-result",
      });
    });
  });

  describe("sent branch (Resend ok)", () => {
    it("returns sent with the Resend message id", () => {
      const decision = decideRecordingReadyEmailOutcome({
        recipient: baseRecipient,
        sendResult: { ok: true, id: "re_abc123" },
      });

      expect(decision.outcome).toBe("sent");
      expect(decision.reason).toBe("resend-ok");
      expect(decision.providerEmailId).toBe("re_abc123");
      expect(decision.sideEffect).toEqual({
        kind: "mark-sent",
        providerEmailId: "re_abc123",
      });
    });

    it("uses resend_no_id sentinel when Resend returns no id (should be unreachable in practice)", () => {
      const decision = decideRecordingReadyEmailOutcome({
        recipient: baseRecipient,
        sendResult: { ok: true, id: null },
      });

      expect(decision.outcome).toBe("sent");
      expect(decision.providerEmailId).toBe("resend_no_id");
      expect(decision.sideEffect).toEqual({
        kind: "mark-sent",
        providerEmailId: "resend_no_id",
      });
    });
  });

  describe("dev_skipped branch", () => {
    it("returns dev_skipped when sendResult.skipped is true", () => {
      const decision = decideRecordingReadyEmailOutcome({
        recipient: baseRecipient,
        sendResult: {
          ok: false,
          skipped: true,
          reason: "Email provider not configured (dev)",
        },
      });

      expect(decision.outcome).toBe("dev_skipped");
      expect(decision.reason).toBe("Email provider not configured (dev)");
      expect(decision.providerEmailId).toBe("dev_skipped");
      expect(decision.sideEffect).toEqual({
        kind: "mark-sent",
        providerEmailId: "dev_skipped",
      });
    });
  });

  describe("failed (Resend error) branch", () => {
    it("returns failed with resend:{error} deliveryError", () => {
      const decision = decideRecordingReadyEmailOutcome({
        recipient: baseRecipient,
        sendResult: { ok: false, error: "API key invalid" },
      });

      expect(decision.outcome).toBe("failed");
      expect(decision.reason).toBe("API key invalid");
      expect(decision.providerEmailId).toBe("");
      expect(decision.sideEffect).toEqual({
        kind: "mark-failed",
        deliveryError: "resend:API key invalid",
      });
    });

    it("caps deliveryError at 500 characters to fit the recordingReadyNotifications row", () => {
      const longError = "x".repeat(800);
      const decision = decideRecordingReadyEmailOutcome({
        recipient: baseRecipient,
        sendResult: { ok: false, error: longError },
      });

      expect(decision.outcome).toBe("failed");
      expect(decision.sideEffect.kind).toBe("mark-failed");
      if (decision.sideEffect.kind === "mark-failed") {
        expect(decision.sideEffect.deliveryError.length).toBe(500);
        expect(decision.sideEffect.deliveryError).toMatch(/^resend:/);
      }
    });

    it("returns failed with the reason preserved for log readability", () => {
      const decision = decideRecordingReadyEmailOutcome({
        recipient: baseRecipient,
        sendResult: { ok: false, error: "rate limit exceeded" },
      });

      expect(decision.outcome).toBe("failed");
      expect(decision.reason).toBe("rate limit exceeded");
    });
  });

  describe("branch ordering", () => {
    it("preference check beats no_email", () => {
      const decision = decideRecordingReadyEmailOutcome({
        recipient: {
          ...baseRecipient,
          recordingReadyEmail: false,
          email: null,
          workspaceId: null,
        },
      });
      expect(decision.outcome).toBe("opted_out");
    });

    it("preference check beats missing-workspace-id", () => {
      const decision = decideRecordingReadyEmailOutcome({
        recipient: {
          ...baseRecipient,
          recordingReadyEmail: false,
          workspaceId: null,
        },
      });
      expect(decision.outcome).toBe("opted_out");
    });

    it("no_email beats missing-workspace-id", () => {
      const decision = decideRecordingReadyEmailOutcome({
        recipient: {
          ...baseRecipient,
          email: null,
          workspaceId: null,
        },
      });
      expect(decision.outcome).toBe("no_email");
    });
  });
});
