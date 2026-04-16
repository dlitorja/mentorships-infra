import { describe, it, expect } from "vitest";
import { getVisibleInstructors, getInstructorBySlug, instructors } from "../../lib/instructors";

describe("Instructor Visibility", () => {
  it("should exclude hidden instructors from visible list", () => {
    const visible = getVisibleInstructors();
    const hiddenInstructor = visible.find(i => i.slug === "test-instructor-waitlist");
    expect(hiddenInstructor).toBeUndefined();
  });

  it("should NOT include hidden instructor when searching by slug directly (returns 404)", () => {
    const instructor = getInstructorBySlug("test-instructor-waitlist");
    expect(instructor).toBeUndefined();
  });

  it("should include non-hidden instructors in visible list", () => {
    const visible = getVisibleInstructors();
    const jordanJardine = visible.find(i => i.slug === "jordan-jardine");
    expect(jordanJardine).toBeDefined();
    expect(jordanJardine?.isHidden).not.toBe(true);
  });

  it("should return visible instructors (unsorted)", () => {
    const visible = getVisibleInstructors();
    expect(visible.length).toBeGreaterThan(0);
    visible.forEach((instructor) => {
      expect(instructor.isHidden).not.toBe(true);
    });
  });

  it("should have at least 10 visible instructors", () => {
    const visible = getVisibleInstructors();
    expect(visible.length).toBeGreaterThanOrEqual(10);
  });

  it("test instructor exists in raw data but is hidden", () => {
    const rawInstructor = instructors.find(i => i.slug === "test-instructor-waitlist");
    expect(rawInstructor).toBeDefined();
    expect(rawInstructor?.isHidden).toBe(true);
    expect(rawInstructor?.name).toBe("Test Instructor - Waitlist");
    expect(rawInstructor?.tagline).toContain("TEST INSTRUCTOR");
    expect(rawInstructor?.offers).toHaveLength(1);
    expect(rawInstructor?.offers[0]?.kind).toBe("oneOnOne");
  });
});
