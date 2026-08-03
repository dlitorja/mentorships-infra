import { describe, it, expect } from "vitest";
import { getFileExtension } from "./route";

describe("getFileExtension", () => {
  it("returns the lower-case extension for typical filenames", () => {
    expect(getFileExtension("avatar.JPG")).toBe(".jpg");
    expect(getFileExtension("photo.png")).toBe(".png");
    expect(getFileExtension("image.WEBP")).toBe(".webp");
  });

  it("returns an empty string for extensionless filenames", () => {
    expect(getFileExtension("avatar")).toBe("");
    expect(getFileExtension("path/to/file")).toBe("");
  });

  it("handles multiple dots and returns the final extension", () => {
    expect(getFileExtension("archive.tar.gz")).toBe(".gz");
    expect(getFileExtension("my.photo.jpg")).toBe(".jpg");
  });

  it("returns empty for a trailing dot", () => {
    expect(getFileExtension("filename.")).toBe("");
  });
});
