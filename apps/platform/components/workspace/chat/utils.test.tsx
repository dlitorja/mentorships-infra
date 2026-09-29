import { describe, it, expect } from "vitest";
import {
  isLegacyUrlContent,
  parseFileMessage,
  parseImageMessage,
  isImageFileName,
} from "./utils";

describe("isLegacyUrlContent", () => {
  it("treats http:// as a URL", () => {
    expect(isLegacyUrlContent("http://example.com/file.png")).toBe(true);
  });
  it("treats https:// as a URL", () => {
    expect(isLegacyUrlContent("https://example.com/file.png")).toBe(true);
  });
  it("treats the https:/ typo as a URL (defensive against pre-PR-3c typos)", () => {
    expect(isLegacyUrlContent("https:/example.com/file.png")).toBe(true);
  });
  it("rejects raw b2Key content", () => {
    expect(isLegacyUrlContent("2026-09-29/workspaces/ws_1/fileId/photo.png")).toBe(false);
  });
  it("rejects filename-prefixed resource-share content", () => {
    expect(isLegacyUrlContent("photo.png|2026-09-29/workspaces/ws_1/fileId/photo.png")).toBe(false);
  });
});

describe("parseFileMessage", () => {
  it("parses name|url resource-share content", () => {
    expect(parseFileMessage("photo.png|2026-09-29/ws/key")).toEqual({
      fileName: "photo.png",
      url: "2026-09-29/ws/key",
    });
  });
  it("returns the raw content as url when no separator", () => {
    expect(parseFileMessage("https://example.com/photo.png")).toEqual({
      fileName: "Download file",
      url: "https://example.com/photo.png",
    });
  });
  it("decodes URI-encoded filenames", () => {
    expect(parseFileMessage("photo%20with%20spaces.png|key")).toEqual({
      fileName: "photo with spaces.png",
      url: "key",
    });
  });
});

describe("parseImageMessage", () => {
  it("uses 'Shared image' default name for content with no separator", () => {
    expect(parseImageMessage("https://example.com/photo.png")).toEqual({
      fileName: "Shared image",
      url: "https://example.com/photo.png",
    });
  });
  it("preserves the parsed filename when a separator is present", () => {
    expect(parseImageMessage("photo.png|key")).toEqual({
      fileName: "photo.png",
      url: "key",
    });
  });
});

describe("isImageFileName", () => {
  it.each(["a.png", "b.JPG", "c.webp", "d.gif", "e.avif", "f.jpeg", "g.jpg"])(
    "treats %s as an image",
    (name) => expect(isImageFileName(name)).toBe(true)
  );
  it.each(["a.pdf", "b.txt", "c.zip", "d.docx", "e.mp4", "f.JPE"])(
    "treats %s as not an image",
    (name) => expect(isImageFileName(name)).toBe(false)
  );
});
