import { describe, expect, it } from "vitest";
import {
  B2_CLASS_D_FREE_PER_DAY,
  B2_CLASS_D_RATE_PER_10000,
  B2_EGRESS_RATE_PER_GB,
  B2_FREE_EGRESS_MULTIPLE,
  B2_FREE_STORAGE_GB,
  B2_STORAGE_RATE_PER_GB,
  calculateDownloadTransactionCost,
  calculateNotificationTransactionCost,
  calculateUploadTransactionCost,
  estimateB2EgressCost,
  estimateB2StorageCost,
  fetchMonthlyCosts,
} from "./costs";

const GB = 1024 * 1024 * 1024;
const TB = 1024 * GB;

describe("costs — published B2 rates", () => {
  it("pins the current published rates", () => {
    // Guards against a silent revert to the pre-2026-05 figures
    // ($0.006/GB, $0.004 per 1,000 Class A, $0.002 per 1,000 Class B).
    expect(B2_STORAGE_RATE_PER_GB).toBe(0.00695);
    expect(B2_FREE_STORAGE_GB).toBe(10);
    expect(B2_EGRESS_RATE_PER_GB).toBe(0.01);
    expect(B2_FREE_EGRESS_MULTIPLE).toBe(3);
    expect(B2_CLASS_D_RATE_PER_10000).toBe(0.004);
    expect(B2_CLASS_D_FREE_PER_DAY).toBe(2500);
  });

  it("prices 1 TB of storage at $6.95/month, in cents", () => {
    // 1024 GB - 10 GB free = 1014 GB billable.
    expect(estimateB2StorageCost(TB)).toBe(705);
  });

  it("treats storage under the 10 GB allowance as free", () => {
    expect(estimateB2StorageCost(0)).toBe(0);
    expect(estimateB2StorageCost(5 * GB)).toBe(0);
    expect(estimateB2StorageCost(10 * GB)).toBe(0);
  });

  it("class A and class B calls are free", () => {
    expect(calculateUploadTransactionCost(1_000_000)).toBe(0);
    expect(calculateDownloadTransactionCost(1_000_000)).toBe(0);
  });
});

describe("costs — egress", () => {
  it("is free up to 3x stored data", () => {
    const stored = 100 * GB;
    expect(estimateB2EgressCost(stored, 0)).toBe(0);
    expect(estimateB2EgressCost(stored, 300 * GB)).toBe(0);
  });

  it("charges $0.01/GB only on the multiple above 3x", () => {
    const stored = 100 * GB;
    // 400 GB egress - 300 GB free = 100 GB billable = $1.00 = 100 cents.
    expect(estimateB2EgressCost(stored, 400 * GB)).toBe(100);
  });

  it("never returns a negative cost when stored is zero", () => {
    expect(estimateB2EgressCost(0, 0)).toBe(0);
    // 5 GB billable at $0.01/GB = $0.05 = 5 cents.
    expect(estimateB2EgressCost(0, 5 * GB)).toBe(5);
  });
});

describe("costs — Class D (event notifications)", () => {
  it("is free when every day stays under the daily allowance", () => {
    expect(calculateNotificationTransactionCost(Array(30).fill(2_500))).toBe(0);
  });

  it("charges $0.004 per 10,000 calls above the daily free tier", () => {
    // 100,000 billable calls above the day's allowance = $0.04 = 4 cents.
    expect(calculateNotificationTransactionCost([102_500])).toBe(4);
  });

  it("does not pool the daily free allowance across the month", () => {
    // One busy day of 75,000 calls, 29 idle days. A monthly-pooling
    // implementation would report 0 (75,000 < 2,500 x 30) even though
    // 72,500 calls exceeded that day's allowance.
    const callsByDay = [75_000, ...Array(29).fill(0)];
    expect(calculateNotificationTransactionCost(callsByDay)).toBe(3);
  });
});

describe("costs — fetchMonthlyCosts", () => {
  it("returns null instead of fabricated zeros", async () => {
    // Backblaze has no public billing API; a zeroed object is
    // indistinguishable from a measured zero in the UI.
    await expect(fetchMonthlyCosts()).resolves.toBeNull();
  });
});
