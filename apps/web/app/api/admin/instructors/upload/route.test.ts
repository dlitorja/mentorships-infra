import { describe, it, expect } from "vitest";
import { getFileExtension } from "./route";

describe("getFileExtension (web admin/instructors upload)", () => {
  it("returns the lower-case extension for typical filenames", () => {
    expect(getFileExtension("avatar.JPG")).toBe(".jpg");
    expect(getFileExtension("photo.png")).toBe(".png");
    expect(getFileExtension("image.WEBP")).toBe(".webp");
    expect(getFileExtension("art.jpeg")).toBe(".jpeg");
    expect(getFileExtension("anim.GIF")).toBe(".gif");
  });

  it("returns empty for extensionless filenames", () => {
    expect(getFileExtension("avatar")).toBe("");
    expect(getFileExtension("path/to/file")).toBe("");
  });

  it("returns empty for a trailing dot", () => {
    expect(getFileExtension("filename.")).toBe("");
  });

  it("handles multiple dots and returns the final extension", () => {
    expect(getFileExtension("archive.tar.gz")).toBe(".gz");
    expect(getFileExtension("my.photo.jpg")).toBe(".jpg");
  });

  describe("MIME fallback (compressed blob uploads)", () => {
    it("returns the MIME-derived extension when filename is 'blob'", () => {
      expect(getFileExtension("blob", "image/jpeg")).toBe(".jpg");
      expect(getFileExtension("blob", "image/png")).toBe(".png");
      expect(getFileExtension("blob", "image/webp")).toBe(".webp");
      expect(getFileExtension("blob", "image/gif")).toBe(".gif");
    });

    it("returns the MIME-derived extension when filename is empty", () => {
      expect(getFileExtension("", "image/png")).toBe(".png");
    });

    it("returns empty when no MIME is provided for an extensionless filename", () => {
      expect(getFileExtension("blob")).toBe("");
    });

    it("returns empty when MIME is not in the allowed list", () => {
      expect(getFileExtension("blob", "application/octet-stream")).toBe("");
      expect(getFileExtension("blob", "image/svg+xml")).toBe("");
    });

    it("prefers the filename extension over the MIME fallback", () => {
      expect(getFileExtension("real-name.png", "image/jpeg")).toBe(".png");
    });

    it("regression: prior behavior was to default to '.jpg' regardless — that was wrong for PNG/WebP/GIF", () => {
      expect(getFileExtension("blob", "image/png")).not.toBe(".jpg");
      expect(getFileExtension("blob", "image/webp")).not.toBe(".jpg");
      expect(getFileExtension("blob", "image/gif")).not.toBe(".jpg");
    });
  });
});
