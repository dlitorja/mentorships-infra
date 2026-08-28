import { describe, it, expect } from "vitest";
import {
  ALLOWED_CONTENT_TYPES,
  ALLOWED_CONTENT_TYPE_SET,
  isAllowedContentType,
} from "../limits";

describe("ALLOWED_CONTENT_TYPES", () => {
  it("contains all six supported video MIME types", () => {
    expect(ALLOWED_CONTENT_TYPES).toEqual([
      "video/mp4",
      "video/quicktime",
      "video/x-msvideo",
      "video/webm",
      "video/x-matroska",
      "video/mpeg",
    ]);
  });

  it("ALLOWED_CONTENT_TYPE_SET mirrors the array", () => {
    expect(ALLOWED_CONTENT_TYPE_SET.size).toBe(ALLOWED_CONTENT_TYPES.length);
    for (const t of ALLOWED_CONTENT_TYPES) {
      expect(ALLOWED_CONTENT_TYPE_SET.has(t)).toBe(true);
    }
  });
});

describe("isAllowedContentType", () => {
  it("accepts all allowed MIME types", () => {
    for (const t of ALLOWED_CONTENT_TYPES) {
      expect(isAllowedContentType(t)).toBe(true);
    }
  });

  it("rejects disallowed MIME types", () => {
    expect(isAllowedContentType("video/avi")).toBe(false);
    expect(isAllowedContentType("image/png")).toBe(false);
    expect(isAllowedContentType("application/pdf")).toBe(false);
    expect(isAllowedContentType("")).toBe(false);
  });

  it("is case-sensitive on the MIME prefix", () => {
    expect(isAllowedContentType("VIDEO/MP4")).toBe(false);
  });
});
