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
import { convexServerCall, ConvexServerCallError } from "@/lib/convex-server-call";
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

  describe("Convex has live data — trust Convex, do NOT fall back to Supabase", () => {
    it("returns Convex values verbatim when both fields are explicit numbers", async () => {
      vi.mocked(convexServerCall).mockResolvedValue({
        success: true,
        one_on_one_inventory: 4,
        group_inventory: 2,
      });

      const req = makeRequest({
        method: "GET",
        url: `${URL}?slug=jordan-jardine`,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Inventory-Source")).toBe("convex");
      expect(body).toEqual({
        one_on_one_inventory: 4,
        group_inventory: 2,
      });
      // Both fields explicit in Convex → no Supabase fallback.
      expect(getInstructorInventory).not.toHaveBeenCalled();
    });

    it("preserves a live zero from a real Kajabi purchase (does NOT substitute stale Supabase)", async () => {
      // The route must treat Convex=0 (a real value) as
      // authoritative. A stale positive Supabase baseline would
      // otherwise advertise a sold-out offer as available.
      vi.mocked(convexServerCall).mockResolvedValue({
        success: true,
        one_on_one_inventory: 0,
        group_inventory: 0,
      });
      vi.mocked(getInstructorInventory).mockResolvedValue({
        one_on_one_inventory: 5,
        group_inventory: 3,
      });

      const req = makeRequest({
        method: "GET",
        url: `${URL}?slug=sold-out-instructor`,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Inventory-Source")).toBe("convex");
      // Supabase is NOT consulted: a real zero wins.
      expect(body).toEqual({
        one_on_one_inventory: 0,
        group_inventory: 0,
      });
      expect(getInstructorInventory).not.toHaveBeenCalled();
    });

    it("falls back to Supabase ONLY for the field that is null (mixed state)", async () => {
      // Admin manually patched 1:1, but did not touch group yet.
      // Convex 1:1 is set; Convex group is null. Supabase still has
      // the pre-patch baseline for group.
      vi.mocked(convexServerCall).mockResolvedValue({
        success: true,
        one_on_one_inventory: 4,
        group_inventory: null,
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
      expect(response.headers.get("X-Inventory-Source")).toBe("convex-supabase-mixed");
      expect(body).toEqual({
        one_on_one_inventory: 4,
        group_inventory: 3,
      });
    });
  });

  describe("Convex has null/unset fields — read Supabase fallback", () => {
    it("returns Supabase value when Convex has both fields as null (pre-backfill)", async () => {
      vi.mocked(convexServerCall).mockResolvedValue({
        success: true,
        one_on_one_inventory: null,
        group_inventory: null,
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
      expect(response.headers.get("X-Inventory-Source")).toBe("supabase");
      expect(body).toEqual({
        one_on_one_inventory: 5,
        group_inventory: 2,
      });
    });

    it("returns zeros when both Convex (null) and Supabase (null) are empty", async () => {
      vi.mocked(convexServerCall).mockResolvedValue({
        success: true,
        one_on_one_inventory: null,
        group_inventory: null,
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

  describe("Convex read fails — return zeros (no stale Supabase)", () => {
    it("returns zeros when Convex transport fails (does NOT leak stale Supabase positive)", async () => {
      // Greptile P1: a sold-out offer's Convex value is 0; if
      // the next Convex read fails and we fall back to Supabase,
      // a stale positive Supabase value would advertise a
      // checkout link for a sold-out offer. The safe default
      // during a Convex outage is zeros.
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
      expect(response.headers.get("X-Inventory-Source")).toBe("convex-error");
      expect(body).toEqual({
        one_on_one_inventory: 0,
        group_inventory: 0,
      });
      // Supabase MUST NOT be consulted during a Convex outage.
      expect(getInstructorInventory).not.toHaveBeenCalled();
    });

    it("returns zeros when both Convex transport and Supabase call fail", async () => {
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
      expect(response.headers.get("X-Inventory-Source")).toBe("convex-error");
      expect(body).toEqual({
        one_on_one_inventory: 0,
        group_inventory: 0,
      });
    });

    it("treats Convex not-found / unlisted (`{ success: false }`) as zeros — does NOT leak Supabase baseline", async () => {
      // Visibility rule: Convex says "instructor is not publicly
      // visible" (not found, unlisted, or soft-deleted). The
      // route MUST NOT consult Supabase — an unlisted instructor
      // with a retained positive Supabase baseline must not leak.
      vi.mocked(convexServerCall).mockResolvedValue({
        success: false,
        error: "Instructor not found",
      });
      vi.mocked(getInstructorInventory).mockResolvedValue({
        one_on_one_inventory: 2,
        group_inventory: 1,
      });

      const req = makeRequest({
        method: "GET",
        url: `${URL}?slug=missing-instructor`,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Inventory-Source")).toBe("convex-not-found");
      expect(body).toEqual({
        one_on_one_inventory: 0,
        group_inventory: 0,
      });
      // Visibility override: Supabase must NOT be consulted.
      expect(getInstructorInventory).not.toHaveBeenCalled();
    });

    it("treats a 404 from Convex as `convex-not-found` (NOT a transport error)", async () => {
      // Greptile P2 (round 9): `convexServerCall` throws on any
      // non-2xx status. The HTTP action returns 404 when the
      // instructor is not publicly visible. Without explicit
      // handling, the route would label the response
      // `convex-error` instead of `convex-not-found`, making it
      // indistinguishable from a transport outage.
      vi.mocked(convexServerCall).mockRejectedValue(
        new ConvexServerCallError(
          "Convex HTTP 404 at /inventory/get-public-by-slug: Instructor not found",
          404
        )
      );

      const req = makeRequest({
        method: "GET",
        url: `${URL}?slug=hidden-instructor`,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Inventory-Source")).toBe("convex-not-found");
      expect(body).toEqual({
        one_on_one_inventory: 0,
        group_inventory: 0,
      });
    });
  });
});
