import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "tests/unit/test-utils";
import { useUpdateInstructor } from "./use-update-instructor";

/**
 * Saving an instructor only refreshed that instructor's own query, so the
 * admin roster kept rendering the pre-edit row (name, status, capacity) until a
 * hard reload. The hook now invalidates the roster query too.
 */
const instructor = {
  id: "inst_1",
  name: "Ada",
  slug: "ada",
  tagline: null,
  bio: null,
  specialties: [],
  background: [],
  profileImageUrl: null,
  profileImageUploadPath: null,
  portfolioImages: [],
  socials: {},
  isActive: true,
  userId: null,
  instructorId: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        message: "ok",
        instructor,
      }),
    }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeArgs() {
  return {
    instructorId: "inst_1",
    setError: vi.fn(),
    setDeactivationResults: vi.fn(),
    setSuccessMessage: vi.fn(),
    setShowSuccessDialog: vi.fn(),
    setActiveProducts: vi.fn(),
    setShowProductDeactivationDialog: vi.fn(),
    refetch: vi.fn(async () => undefined),
  };
}

describe("useUpdateInstructor", () => {
  it("invalidates the admin roster after a successful save", async () => {
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const args = makeArgs();

    const { result } = renderHook(() => useUpdateInstructor(args), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    await act(async () => {
      await result.current.mutateAsync({ data: { name: "Ada" }, deactivateProducts: false });
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-instructors"] });
    expect(args.refetch).toHaveBeenCalled();
  });
});
