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

describe("/api/instructor/inventory route", () => {
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
      const req = makeRequest({
        method: "GET",
        url: `${URL}?slug=`,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: "Missing slug parameter" });
      expect(convexServerCall).not.toHaveBeenCalled();
    });
  });

  describe("successful Convex response", () => {
    it("returns 200 with snake_case JSON contract preserved", async () => {
      vi.mocked(convexServerCall).mockResolvedValue({
        success: true,
        one_on_one_inventory: 3,
        group_inventory: 2,
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
      expect(body).toEqual({
        one_on_one_inventory: 3,
        group_inventory: 2,
      });
    });

    it("passes through zero values verbatim", async () => {
      vi.mocked(convexServerCall).mockResolvedValue({
        success: true,
        one_on_one_inventory: 0,
        group_inventory: 0,
      });

      const req = makeRequest({
        method: "GET",
        url: `${URL}?slug=cameron-nissen`,
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

  describe("Convex error responses", () => {
    it("returns 200 with zeros when instructor is not found (downgrades 404)", async () => {
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

      // Page renders zeros for unknown slugs so visitors see a graceful
      // response rather than a hard error. The 404 is downgraded to 200
      // with empty inventory.
      expect(response.status).toBe(200);
      expect(body).toEqual({
        one_on_one_inventory: 0,
        group_inventory: 0,
      });
    });

    it("returns 500 when the Convex helper throws a non-not-found error", async () => {
      vi.mocked(convexServerCall).mockRejectedValue(
        new ConvexServerCallError("Convex HTTP 502", 502)
      );

      const req = makeRequest({
        method: "GET",
        url: `${URL}?slug=jordan-jardine`,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({ error: "Failed to fetch inventory" });
    });

    it("returns 500 when the Convex helper throws a generic Error", async () => {
      vi.mocked(convexServerCall).mockRejectedValue(new Error("network gone"));

      const req = makeRequest({
        method: "GET",
        url: `${URL}?slug=jordan-jardine`,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({ error: "Failed to fetch inventory" });
    });
  });
});
