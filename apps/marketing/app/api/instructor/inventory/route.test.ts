import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeRequest } from "../../../../../../tests/unit/api-route-utils";

vi.mock("@/lib/convex-server-call", () => ({
  convexServerCall: vi.fn(),
  ConvexServerCallError: class ConvexServerCallError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ConvexServerCallError";
      this.status = status;
    }
  },
}));

vi.mock("@/lib/supabase-inventory", () => ({
  getInstructorInventory: vi.fn(),
}));

import { GET } from "./route";
import { convexServerCall } from "@/lib/convex-server-call";
import { getInstructorInventory } from "@/lib/supabase-inventory";

const URL = "https://huckleberry-drive.example.com/api/instructor/inventory";

describe("/api/instructor/inventory route (Phase 1 widen)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(convexServerCall).mockReset();
    vi.mocked(getInstructorInventory).mockReset();
  });

  describe("request validation", () => {
    it("returns 400 when the slug query parameter is missing", async () => {
      const req = makeRequest({ method: "GET", url: URL });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: "Missing slug parameter" });
      expect(convexServerCall).not.toHaveBeenCalled();
      expect(getInstructorInventory).not.toHaveBeenCalled();
    });

    it("returns 400 when the slug query parameter is empty", async () => {
      const req = makeRequest({ method: "GET", url: `${URL}?slug=` });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: "Missing slug parameter" });
    });
  });

  describe("Convex has live (non-zero) data — prefer Convex", () => {
    it("returns Convex values verbatim when both fields are non-zero", async () => {
      vi.mocked(convexServerCall).mockResolvedValue({
        success: true,
        one_on_one_inventory: 4,
        group_inventory: 2,
      });
      // Even though Supabase is consulted as a partial-fallback
      // safety net, the route prefers Convex's non-zero values.
      vi.mocked(getInstructorInventory).mockResolvedValue({
        one_on_one_inventory: 99,
        group_inventory: 99,
      });

      const req = makeRequest({
        method: "GET",
        url: `${URL}?slug=jordan-jardine`,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(convexServerCall).toHaveBeenCalledWith(
        "/inventory/get-public-by-slug",
        { slug: "jordan-jardine" }
      );
      expect(response.status).toBe(200);
      // Convex values win over Supabase's stale baseline of 99.
      expect(body).toEqual({
        one_on_one_inventory: 4,
        group_inventory: 2,
      });
    });

    it("falls back to Supabase for any field that is still zero in Convex (partial backfill)", async () => {
      // Admin touched 1:1 manually but did not touch group. The
      // backfill only seeded group. Supabase has the post-backfill
      // ground truth.
      vi.mocked(convexServerCall).mockResolvedValue({
        success: true,
        one_on_one_inventory: 4,
        group_inventory: 0,
      });
      vi.mocked(getInstructorInventory).mockResolvedValue({
        one_on_one_inventory: 0,
        group_inventory: 3,
      });

      const req = makeRequest({
        method: "GET",
        url: `${URL}?slug=cameron-nissen`,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        one_on_one_inventory: 4,
        group_inventory: 3,
      });
    });
  });

  describe("Convex has zero across the board — read Supabase fallback", () => {
    it("returns Supabase value when Convex has both fields as 0 (pre-backfill)", async () => {
      // Pre-backfill: Convex defaults to null/0. Supabase still
      // has the historical baseline.
      vi.mocked(convexServerCall).mockResolvedValue({
        success: true,
        one_on_one_inventory: 0,
        group_inventory: 0,
      });
      vi.mocked(getInstructorInventory).mockResolvedValue({
        one_on_one_inventory: 5,
        group_inventory: 2,
      });

      const req = makeRequest({
        method: "GET",
        url: `${URL}?slug=nino-vecia`,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        one_on_one_inventory: 5,
        group_inventory: 2,
      });
    });

    it("returns zeros when both Convex and Supabase are empty", async () => {
      vi.mocked(convexServerCall).mockResolvedValue({
        success: true,
        one_on_one_inventory: 0,
        group_inventory: 0,
      });
      vi.mocked(getInstructorInventory).mockResolvedValue(null);

      const req = makeRequest({
        method: "GET",
        url: `${URL}?slug=oliver-titley`,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        one_on_one_inventory: 0,
        group_inventory: 0,
      });
    });
  });

  describe("Convex read fails — Supabase fallback", () => {
    it("returns Supabase value when Convex HTTP rejects", async () => {
      vi.mocked(convexServerCall).mockRejectedValue(
        new Error("network gone")
      );
      vi.mocked(getInstructorInventory).mockResolvedValue({
        one_on_one_inventory: 3,
        group_inventory: 1,
      });

      const req = makeRequest({
        method: "GET",
        url: `${URL}?slug=malina-dowling`,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        one_on_one_inventory: 3,
        group_inventory: 1,
      });
    });

    it("returns zeros when both Convex and Supabase are unavailable", async () => {
      vi.mocked(convexServerCall).mockRejectedValue(new Error("boom"));
      vi.mocked(getInstructorInventory).mockRejectedValue(
        new Error("also boom")
      );

      const req = makeRequest({
        method: "GET",
        url: `${URL}?slug=rakasa`,
      });
      const response = await GET(req);
      const body = await response.json();

      // Page renders zeros so visitors see a graceful response.
      expect(response.status).toBe(200);
      expect(body).toEqual({
        one_on_one_inventory: 0,
        group_inventory: 0,
      });
    });

    it("treats Convex not-found (`{ success: false }`) as zero and falls back to Supabase", async () => {
      vi.mocked(convexServerCall).mockResolvedValue({
        success: false,
        error: "Instructor not found",
      });
      vi.mocked(getInstructorInventory).mockResolvedValue({
        one_on_one_inventory: 2,
        group_inventory: 0,
      });

      const req = makeRequest({
        method: "GET",
        url: `${URL}?slug=missing-instructor`,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        one_on_one_inventory: 2,
        group_inventory: 0,
      });
    });
  });
});
