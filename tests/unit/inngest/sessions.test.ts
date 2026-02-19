import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the client module
vi.mock("../../../apps/web/inngest/client", () => ({
  inngest: {
    createFunction: vi.fn((config, _trigger, handler) => ({
      id: config.id,
      name: config.name,
      config,
      handler,
    })),
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock dependencies
vi.mock("@mentorships/db", () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: "test-id" }]),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
  },
  sessions: {},
  sessionPacks: {},
  seatReservations: {},
  eq: vi.fn(),
  and: vi.fn(() => ({})),
  lte: vi.fn(() => ({})),
  sql: vi.fn((strings) => strings),
  getSessionById: vi.fn(),
  getSessionPackById: vi.fn(),
  getCompletedSessionCount: vi.fn(),
  decrementRemainingSessions: vi.fn(),
  updateSeatReservationStatus: vi.fn(),
  updateSessionPackStatus: vi.fn(),
}));

vi.mock("../../../apps/web/lib/observability", () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
}));

describe("Inngest Session Functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should export all session functions", async () => {
    const sessionModule = await import("../../../apps/web/inngest/functions/sessions");

    expect(sessionModule.handleSessionCompleted).toBeDefined();
    expect(sessionModule.checkSeatExpiration).toBeDefined();
    expect(sessionModule.handleRenewalReminder).toBeDefined();
    expect(sessionModule.sendGracePeriodFinalWarning).toBeDefined();
  });

  it("handleSessionCompleted should have correct configuration", async () => {
    const sessionModule = await import("../../../apps/web/inngest/functions/sessions");

    expect(sessionModule.handleSessionCompleted.id).toBe("handle-session-completed");
    expect(sessionModule.handleSessionCompleted.name).toBe("Handle Session Completed");
    expect(sessionModule.handleSessionCompleted.config.retries).toBe(3);
  });

  it("checkSeatExpiration should have correct configuration", async () => {
    const sessionModule = await import("../../../apps/web/inngest/functions/sessions");

    expect(sessionModule.checkSeatExpiration.id).toBe("check-seat-expiration");
    expect(sessionModule.checkSeatExpiration.name).toBe("Check Seat Expiration");
    expect(sessionModule.checkSeatExpiration.config.retries).toBe(2);
  });

  it("handleRenewalReminder should have correct configuration", async () => {
    const sessionModule = await import("../../../apps/web/inngest/functions/sessions");

    expect(sessionModule.handleRenewalReminder.id).toBe("handle-renewal-reminder");
    expect(sessionModule.handleRenewalReminder.name).toBe("Handle Renewal Reminder");
    expect(sessionModule.handleRenewalReminder.config.retries).toBe(2);
  });

  it("sendGracePeriodFinalWarning should have correct configuration", async () => {
    const sessionModule = await import("../../../apps/web/inngest/functions/sessions");

    expect(sessionModule.sendGracePeriodFinalWarning.id).toBe("send-grace-period-final-warning");
    expect(sessionModule.sendGracePeriodFinalWarning.name).toBe("Send Grace Period Final Warning");
    expect(sessionModule.sendGracePeriodFinalWarning.config.retries).toBe(2);
  });

  describe("Business Logic Tests", () => {
    it("should handle session completion and decrement sessions", async () => {
      const {
        getSessionById,
        getSessionPackById,
        decrementRemainingSessions,
        getCompletedSessionCount,
      } = await import("@mentorships/db");
      const sessionModule = await import("../../../apps/web/inngest/functions/sessions");

      const mockSession = {
        id: "session_123",
        status: "completed",
        sessionPackId: "pack_123",
      };

      const mockPack = {
        id: "pack_123",
        userId: "user_123",
        mentorId: "mentor_123",
        totalSessions: 4,
        remainingSessions: 3,
      };

      const mockUpdatedPack = {
        id: "pack_123",
        remainingSessions: 2,
      };

      vi.mocked(getSessionById).mockResolvedValue(mockSession as any);
      vi.mocked(getSessionPackById).mockResolvedValue(mockPack as any);
      vi.mocked(decrementRemainingSessions).mockResolvedValue(mockUpdatedPack as any);
      vi.mocked(getCompletedSessionCount).mockResolvedValue(2);

      const mockEvent = {
        data: {
          sessionId: "session_123",
          sessionPackId: "pack_123",
          userId: "user_123",
        },
      };

      const mockStep = {
        run: vi.fn(async (name: string, fn: () => Promise<any>) => fn()),
      };

      const handler = sessionModule.handleSessionCompleted.handler;
      const result = await handler({ event: mockEvent, step: mockStep as any } as any);

      expect(result.success).toBe(true);
      expect(result.sessionId).toBe("session_123");
      expect(result.remainingSessions).toBe(2);
      expect(result.completedCount).toBe(2);
    });

    it("should throw error when session not found", async () => {
      const { getSessionById } = await import("@mentorships/db");
      const sessionModule = await import("../../../apps/web/inngest/functions/sessions");

      vi.mocked(getSessionById).mockResolvedValue(null);

      const mockEvent = {
        data: {
          sessionId: "session_nonexistent",
          sessionPackId: "pack_123",
          userId: "user_123",
        },
      };

      const mockStep = {
        run: vi.fn(async (name: string, fn: () => Promise<any>) => {
          if (name === "get-session") {
            const sess = await getSessionById("session_nonexistent");
            if (!sess) {
              throw new Error("Session session_nonexistent not found");
            }
            return sess;
          }
          return fn();
        }),
      };

      const handler = sessionModule.handleSessionCompleted.handler;
      await expect(
        handler({ event: mockEvent, step: mockStep as any } as any)
      ).rejects.toThrow("Session session_nonexistent not found");
    });

    it("should throw error when session is not completed", async () => {
      const { getSessionById } = await import("@mentorships/db");
      const sessionModule = await import("../../../apps/web/inngest/functions/sessions");

      const mockSession = {
        id: "session_123",
        status: "scheduled",
        sessionPackId: "pack_123",
      };

      vi.mocked(getSessionById).mockResolvedValue(mockSession as any);

      const mockEvent = {
        data: {
          sessionId: "session_123",
          sessionPackId: "pack_123",
          userId: "user_123",
        },
      };

      const mockStep = {
        run: vi.fn(async (name: string, fn: () => Promise<any>) => {
          if (name === "get-session") {
            const sess = await getSessionById("session_123");
            if (!sess) {
              throw new Error("Session session_123 not found");
            }
            if (sess.status !== "completed") {
              throw new Error("Session session_123 is not completed");
            }
            return sess;
          }
          return fn();
        }),
      };

      const handler = sessionModule.handleSessionCompleted.handler;
      await expect(
        handler({ event: mockEvent, step: mockStep as any } as any)
      ).rejects.toThrow("Session session_123 is not completed");
    });

    it("should send session 3 renewal reminder", async () => {
      const { getSessionPackById } = await import("@mentorships/db");
      const { inngest } = await import("../../../apps/web/inngest/client");
      const sessionModule = await import("../../../apps/web/inngest/functions/sessions");

      const mockPack = {
        id: "pack_123",
        userId: "user_123",
        mentorId: "mentor_123",
        remainingSessions: 1,
      };

      vi.mocked(getSessionPackById).mockResolvedValue(mockPack as any);

      const mockEvent = {
        data: {
          sessionPackId: "pack_123",
          userId: "user_123",
          sessionNumber: 3,
          remainingSessions: 1,
        },
      };

      const mockStep = {
        run: vi.fn(async (name: string, fn: () => Promise<any>) => {
          if (name === "send-session-3-notification") {
            await inngest.send({
              name: "notification/send",
              data: {
                type: "renewal_reminder",
                userId: "user_123",
                sessionPackId: "pack_123",
                message: "You have 1 session remaining. Renew now to continue your mentorship.",
                sessionNumber: 3,
              },
            });
            return;
          }
          return fn();
        }),
      };

      const handler = sessionModule.handleRenewalReminder.handler;
      const result = await handler({ event: mockEvent, step: mockStep as any } as any);

      expect(result.success).toBe(true);
      expect(result.sessionNumber).toBe(3);
      expect(inngest.send).toHaveBeenCalledWith({
        name: "notification/send",
        data: expect.objectContaining({
          type: "renewal_reminder",
          sessionNumber: 3,
        }),
      });
    });

    it("should throw error when session pack not found for renewal", async () => {
      const { getSessionPackById } = await import("@mentorships/db");
      const sessionModule = await import("../../../apps/web/inngest/functions/sessions");

      vi.mocked(getSessionPackById).mockResolvedValue(null);

      const mockEvent = {
        data: {
          sessionPackId: "pack_nonexistent",
          userId: "user_123",
          sessionNumber: 3,
          remainingSessions: 1,
        },
      };

      const mockStep = {
        run: vi.fn(async (name: string, fn: () => Promise<any>) => {
          if (name === "get-pack") {
            const pack = await getSessionPackById("pack_nonexistent");
            if (!pack) {
              throw new Error("Session pack pack_nonexistent not found");
            }
            return pack;
          }
          return fn();
        }),
      };

      const handler = sessionModule.handleRenewalReminder.handler;
      await expect(
        handler({ event: mockEvent, step: mockStep as any } as any)
      ).rejects.toThrow("Session pack pack_nonexistent not found");
    });
  });
});
