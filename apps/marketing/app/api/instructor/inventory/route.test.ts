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

import { GET } from "./route";
import { convexServerCall, ConvexServerCallError } from "@/lib/convex-server-call";

const URL = "https://huckleberry-drive.example.com/api/instructor/inventory";

describe("/api/instructor/inventory route (Phase 3 Convex-only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(convexServerCall).mockReset();
  });

  describe("request validation", () => {
    it("returns 400 when the slug query parameter is missing", async () => {
      const req = makeRequest({ method: "GET", url: URL });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: "Missing slug parameter" });
      expect(convexServerCall).not.toHaveBeenCalled();
    });

    it("returns 400 when the slug query parameter is empty", async () => {
      const req = makeRequest({ method: "GET", url: `${URL}?slug=` });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: "Missing slug parameter" });
    });
  });

  describe("Convex returns live data", () => {
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
    });

    it("preserves a live zero from a real Kajabi purchase", async () => {
      // Convex=0 is the authoritative "sold out" signal. After
      // Phase 3 the route cannot substitute a stale value from
      // anywhere else — there is no fallback. This regression
      // guard ensures we never re-introduce a fallback that would
      // advertise a sold-out offer as available.
      vi.mocked(convexServerCall).mockResolvedValue({
        success: true,
        one_on_one_inventory: 0,
        group_inventory: 0,
      });

      const req = makeRequest({
        method: "GET",
        url: `${URL}?slug=sold-out-instructor`,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Inventory-Source")).toBe("convex");
      expect(body).toEqual({
        one_on_one_inventory: 0,
        group_inventory: 0,
      });
    });

    it("coerces null Convex fields to 0 and tags source as `convex-unset`", async () => {
      // A `null` field in Convex is the "never written" signal.
      // The page treats both 0 and null as "sold out", but the
      // route contract requires a number. Coerce so the client
      // sees the same shape as a real zero, AND surface the
      // `convex-unset` source label so the operator histogram can
      // flag this as a backfill gap rather than a real sold-out.
      // Greptile P1 (PR #883 round 19): the source label must
      // distinguish null-coerced-to-0 from a real Kajabi-purchase
      // zero — the two are operationally very different signals.
      vi.mocked(convexServerCall).mockResolvedValue({
        success: true,
        one_on_one_inventory: null,
        group_inventory: 3,
      });

      const req = makeRequest({
        method: "GET",
        url: `${URL}?slug=pre-backfill-partial`,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Inventory-Source")).toBe("convex-unset");
      expect(body).toEqual({
        one_on_one_inventory: 0,
        group_inventory: 3,
      });
    });

    it("coerces both Convex fields to 0 with `convex-unset` when both are null", async () => {
      // The operator's pre-merge prerequisite is to run
      // `ZERO_FILL_NULLS=1 pnpm backfill:inventory` on prod so
      // that no public-offer-visible instructor is in this state
      // at the moment the Phase 3 SQL migration is applied. Until
      // then, the source histogram is the operator's signal that
      // a backfill pass is needed.
      vi.mocked(convexServerCall).mockResolvedValue({
        success: true,
        one_on_one_inventory: null,
        group_inventory: null,
      });

      const req = makeRequest({
        method: "GET",
        url: `${URL}?slug=pre-backfill`,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Inventory-Source")).toBe("convex-unset");
      expect(body).toEqual({
        one_on_one_inventory: 0,
        group_inventory: 0,
      });
    });
  });

  describe("Convex visibility refusal", () => {
    it("treats Convex `{ success: false }` as `convex-not-found` (zeros)", async () => {
      vi.mocked(convexServerCall).mockResolvedValue({
        success: false,
        error: "Instructor not found",
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
    });

    it("treats a 404 from Convex as `convex-not-found` (NOT a transport error)", async () => {
      // `convexServerCall` throws on any non-2xx status. The HTTP
      // action returns 404 when the instructor is not publicly
      // visible. Without explicit handling, the route would label
      // the response `convex-error` instead of `convex-not-found`,
      // making it indistinguishable from a transport outage.
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

  describe("Convex transport failure", () => {
    it("returns zeros with `convex-error` when the transport throws", async () => {
      // After Phase 3 there is no fallback — a Convex outage
      // surfaces as zeros + `convex-error` so on-call can
      // distinguish this from a real sold-out.
      vi.mocked(convexServerCall).mockRejectedValue(new Error("network gone"));

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
    });
  });
});
