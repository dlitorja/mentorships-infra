import { describe, expect, it, vi } from "vitest";
import {
  isStaleOnboardingRow,
  type StaleOnboardingRow,
  type StaleSessionPack,
} from "./stale-onboarding-filter";

const CUTOFF = 1_700_000_000_000;

function makeRow(overrides: Partial<StaleOnboardingRow> = {}): StaleOnboardingRow {
  return {
    createdAt: CUTOFF - 60_000,
    email: "user@example.com",
    perInstructor: [
      {
        isRenewal: false,
        sessionPackId: "pack_1",
      },
    ],
    ...overrides,
  };
}

function makePack(overrides: Partial<StaleSessionPack> = {}): StaleSessionPack {
  return {
    status: "active",
    userId: "email:user@example.com",
    ...overrides,
  };
}

describe("isStaleOnboardingRow", () => {
  it("returns false when row was created at or after the cutoff", async () => {
    const fetchPack = vi.fn();
    expect(await isStaleOnboardingRow({ ...makeRow(), createdAt: CUTOFF }, CUTOFF, fetchPack)).toBe(false);
    expect(await isStaleOnboardingRow({ ...makeRow(), createdAt: CUTOFF + 1 }, CUTOFF, fetchPack)).toBe(false);
    expect(fetchPack).not.toHaveBeenCalled();
  });

  it("returns false when email starts with the clerk: prefix", async () => {
    const fetchPack = vi.fn();
    expect(
      await isStaleOnboardingRow(
        { ...makeRow(), email: "clerk:user_abc" },
        CUTOFF,
        fetchPack,
      ),
    ).toBe(false);
    expect(fetchPack).not.toHaveBeenCalled();
  });

  it("returns false when perInstructor is missing or empty", async () => {
    const fetchPack = vi.fn();
    expect(
      await isStaleOnboardingRow({ ...makeRow(), perInstructor: undefined }, CUTOFF, fetchPack),
    ).toBe(false);
    expect(
      await isStaleOnboardingRow({ ...makeRow(), perInstructor: [] }, CUTOFF, fetchPack),
    ).toBe(false);
    expect(
      await isStaleOnboardingRow({ ...makeRow(), perInstructor: null }, CUTOFF, fetchPack),
    ).toBe(false);
    expect(fetchPack).not.toHaveBeenCalled();
  });

  it("returns false when all pairs are renewals", async () => {
    const fetchPack = vi.fn();
    const row = makeRow({
      perInstructor: [
        { isRenewal: true, sessionPackId: "pack_1" },
        { isRenewal: true, sessionPackId: "pack_2" },
      ],
    });
    expect(await isStaleOnboardingRow(row, CUTOFF, fetchPack)).toBe(false);
    expect(fetchPack).not.toHaveBeenCalled();
  });

  it("returns false when non-renewal pair has no sessionPackId", async () => {
    const fetchPack = vi.fn();
    const row = makeRow({
      perInstructor: [
        { isRenewal: false, sessionPackId: undefined },
        { isRenewal: false, sessionPackId: null },
      ],
    });
    expect(await isStaleOnboardingRow(row, CUTOFF, fetchPack)).toBe(false);
    expect(fetchPack).not.toHaveBeenCalled();
  });

  it("returns false when the pack is missing", async () => {
    const fetchPack = vi.fn().mockResolvedValue(null);
    expect(await isStaleOnboardingRow(makeRow(), CUTOFF, fetchPack)).toBe(false);
    expect(fetchPack).toHaveBeenCalledTimes(1);
  });

  it("returns false when the pack status is not active", async () => {
    const fetchPack = vi
      .fn()
      .mockResolvedValue(makePack({ status: "depleted" }));
    expect(await isStaleOnboardingRow(makeRow(), CUTOFF, fetchPack)).toBe(false);
  });

  it("returns false when the pack userId is no longer a placeholder", async () => {
    const fetchPack = vi
      .fn()
      .mockResolvedValue(
        makePack({ userId: "user_2abc|user@example.com" }),
      );
    expect(await isStaleOnboardingRow(makeRow(), CUTOFF, fetchPack)).toBe(false);
  });

  it("returns false when the pack userId is not a string", async () => {
    const fetchPack = vi
      .fn()
      .mockResolvedValue(
        makePack({ userId: 42 as unknown as string | null }),
      );
    expect(await isStaleOnboardingRow(makeRow(), CUTOFF, fetchPack)).toBe(false);
  });

  it("returns true on the first placeholder match and stops probing", async () => {
    const fetchPack = vi
      .fn()
      .mockResolvedValueOnce(makePack()) // first pair: placeholder
      .mockResolvedValueOnce(makePack({ userId: "user_x|user@example.com" }));
    const row = makeRow({
      perInstructor: [
        { isRenewal: false, sessionPackId: "pack_1" },
        { isRenewal: false, sessionPackId: "pack_2" },
      ],
    });
    expect(await isStaleOnboardingRow(row, CUTOFF, fetchPack)).toBe(true);
    expect(fetchPack).toHaveBeenCalledTimes(1);
    expect(fetchPack).toHaveBeenCalledWith("pack_1");
  });

  it("skips renewal / no-pack pairs before probing placeholder packs", async () => {
    const fetchPack = vi
      .fn()
      .mockResolvedValueOnce(null) // pack missing → continue
      .mockResolvedValueOnce(makePack({ status: "depleted" })) // wrong status → continue
      .mockResolvedValueOnce(makePack()); // active + email: prefix → match
    const row = makeRow({
      perInstructor: [
        { isRenewal: true, sessionPackId: "pack_renew" },
        { isRenewal: false, sessionPackId: "pack_missing" },
        { isRenewal: false, sessionPackId: "pack_depleted" },
        { isRenewal: false, sessionPackId: "pack_placeholder" },
      ],
    });
    expect(await isStaleOnboardingRow(row, CUTOFF, fetchPack)).toBe(true);
    expect(fetchPack).toHaveBeenCalledTimes(3);
    expect(fetchPack.mock.calls.map((c) => c[0])).toEqual([
      "pack_missing",
      "pack_depleted",
      "pack_placeholder",
    ]);
  });

  it("returns false when no pair ever matches (probes every non-renewal pair)", async () => {
    const fetchPack = vi
      .fn()
      .mockResolvedValue(makePack({ userId: "user_x|user@example.com" }));
    const row = makeRow({
      perInstructor: [
        { isRenewal: false, sessionPackId: "pack_1" },
        { isRenewal: false, sessionPackId: "pack_2" },
        { isRenewal: false, sessionPackId: "pack_3" },
      ],
    });
    expect(await isStaleOnboardingRow(row, CUTOFF, fetchPack)).toBe(false);
    expect(fetchPack).toHaveBeenCalledTimes(3);
  });
});
