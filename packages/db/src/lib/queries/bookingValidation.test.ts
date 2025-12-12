import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

type MockRow = { pack: unknown; seat: unknown };
let mockRows: MockRow[] = [];

// bookingValidation.ts imports db from "../drizzle". For unit tests, we mock the
// chain used in getPackWithSeat so we can test logic without a real DB.
vi.mock("../drizzle", () => {
  return {
    db: {
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              limit: async () => mockRows,
            }),
          }),
        }),
      }),
    },
  };
});

describe("validateBookingEligibility", () => {
  let bookingValidation: typeof import("./bookingValidation");

  beforeAll(async () => {
    bookingValidation = await import("./bookingValidation");
  });

  afterEach(() => {
    mockRows = [];
  });

  it("returns PACK_NOT_FOUND when pack missing", async () => {
    mockRows = [];

    const res = await bookingValidation.validateBookingEligibility(
      "00000000-0000-0000-0000-000000000000",
      "user_123"
    );

    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.errorCode).toBe("PACK_NOT_FOUND");
  });

  it("returns PACK_EXPIRED when pack is expired", async () => {
    mockRows = [
      {
        pack: {
          expiresAt: new Date(Date.now() - 60_000),
          status: "active",
          remainingSessions: 1,
        },
        seat: { status: "active" },
      },
    ];

    const res = await bookingValidation.validateBookingEligibility(
      "00000000-0000-0000-0000-000000000000",
      "user_123"
    );

    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.errorCode).toBe("PACK_EXPIRED");
  });

  it("returns SCHEDULED_AFTER_EXPIRATION when scheduledAt is after expiration", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    mockRows = [
      {
        pack: {
          expiresAt,
          status: "active",
          remainingSessions: 1,
        },
        seat: { status: "active" },
      },
    ];

    const res = await bookingValidation.validateBookingEligibility(
      "00000000-0000-0000-0000-000000000000",
      "user_123",
      new Date(expiresAt.getTime() + 1_000)
    );

    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.errorCode).toBe("SCHEDULED_AFTER_EXPIRATION");
  });

  it("returns PACK_NOT_ACTIVE when pack status is not active", async () => {
    mockRows = [
      {
        pack: {
          expiresAt: new Date(Date.now() + 60_000),
          status: "depleted",
          remainingSessions: 1,
        },
        seat: { status: "active" },
      },
    ];

    const res = await bookingValidation.validateBookingEligibility(
      "00000000-0000-0000-0000-000000000000",
      "user_123"
    );

    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.errorCode).toBe("PACK_NOT_ACTIVE");
  });

  it("returns NO_REMAINING_SESSIONS when remainingSessions is 0", async () => {
    mockRows = [
      {
        pack: {
          expiresAt: new Date(Date.now() + 60_000),
          status: "active",
          remainingSessions: 0,
        },
        seat: { status: "active" },
      },
    ];

    const res = await bookingValidation.validateBookingEligibility(
      "00000000-0000-0000-0000-000000000000",
      "user_123"
    );

    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.errorCode).toBe("NO_REMAINING_SESSIONS");
  });

  it("returns SEAT_NOT_ACTIVE when seat is missing", async () => {
    mockRows = [
      {
        pack: {
          expiresAt: new Date(Date.now() + 60_000),
          status: "active",
          remainingSessions: 1,
        },
        seat: null,
      },
    ];

    const res = await bookingValidation.validateBookingEligibility(
      "00000000-0000-0000-0000-000000000000",
      "user_123"
    );

    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.errorCode).toBe("SEAT_NOT_ACTIVE");
  });

  it("returns SEAT_NOT_ACTIVE when seat is in grace", async () => {
    mockRows = [
      {
        pack: {
          expiresAt: new Date(Date.now() + 60_000),
          status: "active",
          remainingSessions: 1,
        },
        seat: { status: "grace" },
      },
    ];

    const res = await bookingValidation.validateBookingEligibility(
      "00000000-0000-0000-0000-000000000000",
      "user_123"
    );

    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.errorCode).toBe("SEAT_NOT_ACTIVE");
  });

  it("returns valid: true when all checks pass", async () => {
    mockRows = [
      {
        pack: {
          expiresAt: new Date(Date.now() + 60_000),
          status: "active",
          remainingSessions: 1,
        },
        seat: { status: "active" },
      },
    ];

    const res = await bookingValidation.validateBookingEligibility(
      "00000000-0000-0000-0000-000000000000",
      "user_123"
    );

    expect(res).toEqual({ valid: true });
  });
});

