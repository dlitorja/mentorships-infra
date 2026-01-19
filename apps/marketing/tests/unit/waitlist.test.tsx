import { describe, it, expect } from "vitest";
import { getVisibleInstructors, getInstructorBySlug } from "../../lib/instructors";

describe("Instructor Visibility", () => {
  it("should exclude hidden instructors from visible list", () => {
    const visible = getVisibleInstructors();
    const hiddenInstructor = visible.find(i => i.slug === "test-instructor-waitlist");
    expect(hiddenInstructor).toBeUndefined();
  });

  it("should include hidden instructor when searching by slug directly", () => {
    const instructor = getInstructorBySlug("test-instructor-waitlist");
    expect(instructor).toBeDefined();
    expect(instructor?.slug).toBe("test-instructor-waitlist");
    expect(instructor?.isHidden).toBe(true);
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

  it("should have at least 10 instructors total", () => {
    const visible = getVisibleInstructors();
    const hasTestInstructor = getInstructorBySlug("test-instructor-waitlist") !== undefined;
    const total = visible.length + (hasTestInstructor ? 1 : 0);
    expect(total).toBeGreaterThanOrEqual(10);
  });

  it("test instructor should have correct properties", () => {
    const instructor = getInstructorBySlug("test-instructor-waitlist");
    expect(instructor).toBeDefined();
    expect(instructor?.name).toBe("Test Instructor - Waitlist");
    expect(instructor?.tagline).toContain("TEST INSTRUCTOR");
    expect(instructor?.offers).toHaveLength(1);
    expect(instructor?.offers[0]?.kind).toBe("oneOnOne");
  });
});
