/**
 * Companion to `route.test.ts`. Exercises the lazy dynamic-import
 * error path in `loadInventoryReader` — the case where the
 * `@/lib/supabase-inventory` module itself throws at import time
 * (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY unset
 * in a Convex-only environment during the Phase 3 narrow rollout
 * window).
 *
 * The static `vi.mock` in `route.test.ts` cannot trigger this
 * path because the mock factory returns a valid module object.
 * Here we use `vi.doMock` + `vi.resetModules` so the dynamic
 * `import("@/lib/supabase-inventory")` inside the route resolves
 * to a throwing factory — the closest simulation of a real
 * module-load failure vitest can produce.
 */
import { describe, it, expect, vi } from "vitest";
import { makeRequest } from "../../../../../../tests/unit/api-route-utils";

const URL = "https://huckleberry-drive.example.com/api/instructor/inventory";

async function loadRouteWithSupabaseImportWorking(
  convexCall: ReturnType<typeof vi.fn>
) {
  vi.resetModules();
  vi.doMock("@/lib/convex-server-call", () => ({
    convexServerCall: convexCall,
    ConvexServerCallError: class ConvexServerCallError extends Error {
      readonly status: number;
      constructor(message: string, status: number) {
        super(message);
        this.name = "ConvexServerCallError";
        this.status = status;
      }
    },
  }));
  vi.doMock("@/lib/supabase-inventory", () => ({
    getInstructorInventory: vi.fn(),
  }));
  return await import("./route");
}

async function loadRouteWithSupabaseImportFailing() {
  vi.resetModules();
  vi.doMock("@/lib/convex-server-call", () => ({
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
  vi.doMock("@/lib/supabase-inventory", () => {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be configured"
    );
  });
  return await import("./route");
}

describe("/api/instructor/inventory route — lazy Supabase import failure", () => {
  it("still serves Convex-only values when the Supabase module throws at import time", async () => {
    const convexCall = vi.fn().mockResolvedValue({
      success: true,
      one_on_one_inventory: 7,
      group_inventory: 3,
    });
    const { GET } = await loadRouteWithSupabaseImportWorking(convexCall);

    const response = await GET(
      makeRequest({ method: "GET", url: `${URL}?slug=conor-mclaughlin` })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      one_on_one_inventory: 7,
      group_inventory: 3,
    });
  });

  it("returns zeros when Convex fields are null AND Supabase import fails", async () => {
    const convexCall = vi.fn().mockResolvedValue({
      success: true,
      one_on_one_inventory: null,
      group_inventory: null,
    });
    const { GET } = await loadRouteWithSupabaseImportWorking(convexCall);

    const response = await GET(
      makeRequest({ method: "GET", url: `${URL}?slug=conor-mclaughlin` })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      one_on_one_inventory: 0,
      group_inventory: 0,
    });
  });

  it("returns zeros during a Convex outage when the Supabase module also fails to load", async () => {
    const { GET } = await loadRouteWithSupabaseImportFailing();
    const { convexServerCall } = await import("@/lib/convex-server-call");
    vi.mocked(convexServerCall).mockRejectedValue(new Error("convex down"));

    const response = await GET(
      makeRequest({ method: "GET", url: `${URL}?slug=rakasa` })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      one_on_one_inventory: 0,
      group_inventory: 0,
    });
  });
});
