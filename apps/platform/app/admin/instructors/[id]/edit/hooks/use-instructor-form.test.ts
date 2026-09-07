import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInstructorForm } from "./use-instructor-form";
import type { InstructorDetail } from "../types";

const baseDetail: InstructorDetail = {
  name: "Test Instructor",
  slug: "test",
  email: "test@example.com",
  discordVoiceChannelUrl: null,
  tagline: "Tagline",
  bio: "Bio",
  specialties: [],
  background: [],
  profileImageUrl: "",
  profileImageUploadPath: "",
  portfolioImages: ["a.jpg", "b.jpg", "c.jpg", "d.jpg"],
  socials: {},
  isActive: true,
  isListed: true,
  userId: "user_1",
  instructorId: "legacy_1",
  oneOnOneInventory: 0,
  groupInventory: 0,
  maxActiveStudents: 10,
  useKajabiCheckout: false,
  kajabiCheckoutUrlOneOnOne: "",
  kajabiCheckoutUrlGroup: "",
  testimonials: [],
  studentResults: [],
};

describe("useInstructorForm – portfolio reorder", () => {
  it("seeds portfolioImages from incoming data", () => {
    const { result } = renderHook(() => useInstructorForm(baseDetail));
    expect(result.current.formData.portfolioImages).toEqual(["a.jpg", "b.jpg", "c.jpg", "d.jpg"]);
  });

  it("reorderPortfolioImages moves an item from one index to another", () => {
    const { result } = renderHook(() => useInstructorForm(baseDetail));
    act(() => result.current.reorderPortfolioImages(0, 3));
    expect(result.current.formData.portfolioImages).toEqual(["b.jpg", "c.jpg", "d.jpg", "a.jpg"]);
  });

  it("reorderPortfolioImages is a no-op when from === to", () => {
    const { result } = renderHook(() => useInstructorForm(baseDetail));
    const before = result.current.formData.portfolioImages;
    act(() => result.current.reorderPortfolioImages(1, 1));
    expect(result.current.formData.portfolioImages).toBe(before);
  });

  it("reorderPortfolioImages clamps an out-of-range target index", () => {
    const { result } = renderHook(() => useInstructorForm(baseDetail));
    act(() => result.current.reorderPortfolioImages(0, 99));
    expect(result.current.formData.portfolioImages[result.current.formData.portfolioImages.length - 1]).toBe("a.jpg");
    expect(result.current.formData.portfolioImages.slice(0, -1)).toEqual(["b.jpg", "c.jpg", "d.jpg"]);
  });

  it("reorderPortfolioImages ignores an out-of-range from index", () => {
    const { result } = renderHook(() => useInstructorForm(baseDetail));
    const before = result.current.formData.portfolioImages;
    act(() => result.current.reorderPortfolioImages(-1, 2));
    expect(result.current.formData.portfolioImages).toBe(before);
  });

  it("movePortfolioImage shifts an item up or down by one", () => {
    const { result } = renderHook(() => useInstructorForm(baseDetail));
    act(() => result.current.movePortfolioImage(0, 1));
    expect(result.current.formData.portfolioImages).toEqual(["b.jpg", "a.jpg", "c.jpg", "d.jpg"]);
    act(() => result.current.movePortfolioImage(2, -1));
    expect(result.current.formData.portfolioImages).toEqual(["b.jpg", "c.jpg", "a.jpg", "d.jpg"]);
  });

  it("removePortfolioImage drops an item by index and re-indexes the rest", () => {
    const { result } = renderHook(() => useInstructorForm(baseDetail));
    act(() => result.current.removePortfolioImage(1));
    expect(result.current.formData.portfolioImages).toEqual(["a.jpg", "c.jpg", "d.jpg"]);
  });

  it("exposes the new helpers on the returned hook value", () => {
    const { result } = renderHook(() => useInstructorForm(baseDetail));
    expect(typeof result.current.reorderPortfolioImages).toBe("function");
    expect(typeof result.current.movePortfolioImage).toBe("function");
  });
});
