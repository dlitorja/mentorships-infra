import { describe, it, expect } from "vitest";
import { getFileExtension } from "./route";

describe("getFileExtension (web admin upload)", () => {
  it("returns the lower-case extension for typical filenames", () => {
    expect(getFileExtension("avatar.JPG")).toBe(".jpg");
    expect(getFileExtension("photo.png")).toBe(".png");
  });

  describe("MIME fallback (compressed blob uploads)", () => {
    it("returns the MIME-derived extension when filename is 'blob'", () => {
      expect(getFileExtension("blob", "image/png")).toBe(".png");
      expect(getFileExtension("blob", "image/webp")).toBe(".webp");
      expect(getFileExtension("blob", "image/gif")).toBe(".gif");
      expect(getFileExtension("blob", "image/jpeg")).toBe(".jpg");
    });

    it("returns empty when no MIME is provided for an extensionless filename", () => {
      expect(getFileExtension("blob")).toBe("");
    });

    it("returns empty when MIME is not in the allowed list", () => {
      expect(getFileExtension("blob", "image/svg+xml")).toBe("");
    });

    it("regression: prior behavior was to always default to '.jpg'", () => {
      expect(getFileExtension("blob", "image/png")).not.toBe(".jpg");
      expect(getFileExtension("blob", "image/webp")).not.toBe(".jpg");
      expect(getFileExtension("blob", "image/gif")).not.toBe(".jpg");
    });
  });
});
