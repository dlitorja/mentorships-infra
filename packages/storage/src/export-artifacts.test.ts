import { describe, expect, it } from "vitest";
import {
  EXPORT_ARTIFACT_TTL_MS,
  isExportArtifactKey,
  selectExpiredExportArtifacts,
} from "./export-artifacts";

describe("isExportArtifactKey", () => {
  it("accepts workspace export artifacts", () => {
    expect(isExportArtifactKey("exports/ws123/1700000000-name.zip")).toBe(true);
    expect(isExportArtifactKey("exports/ws123/1700000000-name-links.csv")).toBe(true);
  });

  it("accepts onboarding export artifacts", () => {
    expect(isExportArtifactKey("onboarding/ob123/exports/1700000000-artwork.zip")).toBe(
      true
    );
  });

  it("rejects uploaded artwork and unrelated objects", () => {
    // Uploads live beside the exports directory and must never be swept.
    expect(isExportArtifactKey("onboarding/ob123/file-1/sketch.png")).toBe(false);
    expect(
      isExportArtifactKey("2026-01-01/workspaces/ws123/file-1/sketch.png")
    ).toBe(false);
    expect(isExportArtifactKey("bulk-downloads/2026-01-01/job/chunk-0.zip")).toBe(
      false
    );
  });
});

describe("selectExpiredExportArtifacts", () => {
  const now = Date.UTC(2026, 0, 10);

  it("selects only export artifacts older than the TTL", () => {
    const fresh = now - 60 * 60 * 1000;
    const stale = now - EXPORT_ARTIFACT_TTL_MS - 60 * 1000;

    const keys = selectExpiredExportArtifacts(
      [
        { key: "exports/ws/old.zip", lastModified: stale },
        { key: "exports/ws/new.zip", lastModified: fresh },
        { key: "onboarding/ob/exports/old.zip", lastModified: stale },
        { key: "onboarding/ob/exports/new.zip", lastModified: fresh },
        { key: "onboarding/ob/file/upload.png", lastModified: stale },
      ],
      now
    );

    expect(keys).toEqual([
      "exports/ws/old.zip",
      "onboarding/ob/exports/old.zip",
    ]);
  });

  it("treats the TTL boundary as not expired", () => {
    const exactlyAtCutoff = now - EXPORT_ARTIFACT_TTL_MS;
    expect(
      selectExpiredExportArtifacts(
        [{ key: "exports/ws/boundary.zip", lastModified: exactlyAtCutoff }],
        now
      )
    ).toEqual([]);
  });

  it("honours a custom TTL", () => {
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;
    expect(
      selectExpiredExportArtifacts(
        [{ key: "exports/ws/two-hours.zip", lastModified: twoHoursAgo }],
        now,
        60 * 60 * 1000
      )
    ).toEqual(["exports/ws/two-hours.zip"]);
  });
});
