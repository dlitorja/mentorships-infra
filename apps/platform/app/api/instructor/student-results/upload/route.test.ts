import { describe, it, expect } from "vitest";
import { getFileExtension } from "./route";

describe("getFileExtension (platform instructor student-results upload)", () => {
  it("returns the lower-case extension for typical filenames", () => {
    expect(getFileExtension("avatar.JPG")).toBe(".jpg");
    expect(getFileExtension("photo.png")).toBe(".png");
  });

  describe("MIME fallback (compressed blob uploads)", () => {
    it("returns the MIME-derived extension when filename is 'blob'", () => {
      expect(getFileExtension("blob", "image/jpeg")).toBe(".jpg");
      expect(getFileExtension("blob", "image/png")).toBe(".png");
      expect(getFileExtension("blob", "image/webp")).toBe(".webp");
      expect(getFileExtension("blob", "image/gif")).toBe(".gif");
    });

    it("returns empty when no MIME is provided for an extensionless filename", () => {
      expect(getFileExtension("blob")).toBe("");
    });

    it("returns empty when MIME is not in the allowed list", () => {
      expect(getFileExtension("blob", "image/svg+xml")).toBe("");
    });

    it("prefers the filename extension over the MIME fallback", () => {
      expect(getFileExtension("real-name.png", "image/jpeg")).toBe(".png");
    });

    it("documents the prior buggy behavior for filename 'blob' (returned '' which then failed validation)", () => {
      const priorImpl = (filename: string): string => {
        const lastDot = filename.lastIndexOf(".");
        if (lastDot === -1 || lastDot === filename.length - 1) return "";
        return filename.slice(lastDot).toLowerCase();
      };
      expect(priorImpl("blob")).toBe("");
      expect([".jpg", ".png", ".webp", ".gif"]).not.toContain("");
    });
  });
});
