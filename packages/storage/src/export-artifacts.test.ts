import { describe, expect, it } from "vitest";
import {
  EXPORT_ARTIFACT_TTL_MS,
  isExportArtifactKey,
  selectExpiredExportArtifactVersions,
  selectExpiredExportArtifacts,
} from "./export-artifacts";

describe("isExportArtifactKey", () => {
  it("accepts workspace export artifacts", () => {
    expect(isExportArtifactKey("exports/ws123/1700000000-name.zip")).toBe(true);
    expect(isExportArtifactKey("exports/ws123/1700000000-name-links.csv")).toBe(true);
  });

  it("accepts onboarding export artifacts", () => {
    expect(
      isExportArtifactKey("onboarding-exports/ob123/1700000000-artwork.zip")
    ).toBe(true);
  });

  it("rejects uploaded artwork and unrelated objects", () => {
    // Uploads embed a student-supplied fileId, so they must never be
    // swept — even when the id is literally "exports".
    expect(isExportArtifactKey("onboarding/ob123/file-1/sketch.png")).toBe(false);
    expect(isExportArtifactKey("onboarding/ob123/exports/sketch.png")).toBe(false);
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
        { key: "onboarding-exports/ob/old.zip", lastModified: stale },
        { key: "onboarding-exports/ob/new.zip", lastModified: fresh },
        { key: "onboarding/ob/file/upload.png", lastModified: stale },
      ],
      now
    );

    expect(keys).toEqual([
      "exports/ws/old.zip",
      "onboarding-exports/ob/old.zip",
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

describe("selectExpiredExportArtifactVersions", () => {
  const now = Date.UTC(2026, 0, 10);
  const old = now - EXPORT_ARTIFACT_TTL_MS - 60_000;
  const fresh = now - 60 * 60 * 1000;

  it("deletes every version once the newest version is expired", () => {
    const targets = selectExpiredExportArtifactVersions(
      [
        { key: "exports/ws/a.zip", versionId: "v1", lastModified: old },
        { key: "exports/ws/a.zip", versionId: "v2", lastModified: old + 1000 },
        // Delete marker from an earlier plain delete.
        { key: "exports/ws/a.zip", versionId: "dm", lastModified: old + 2000 },
      ],
      now
    );
    expect(targets).toEqual([
      { key: "exports/ws/a.zip", versionId: "v1" },
      { key: "exports/ws/a.zip", versionId: "v2" },
      { key: "exports/ws/a.zip", versionId: "dm" },
    ]);
  });

  it("keeps a key with any recent version", () => {
    expect(
      selectExpiredExportArtifactVersions(
        [
          { key: "exports/ws/a.zip", versionId: "old", lastModified: old },
          { key: "exports/ws/a.zip", versionId: "new", lastModified: fresh },
        ],
        now
      )
    ).toEqual([]);
  });

  it("ignores uploaded artwork and unrelated keys", () => {
    expect(
      selectExpiredExportArtifactVersions(
        [
          { key: "onboarding/ob/file/u.png", versionId: "v1", lastModified: old },
          { key: "onboarding/ob/exports/legacy.zip", versionId: "v1", lastModified: old },
          { key: "bulk-downloads/x.zip", versionId: "v1", lastModified: old },
        ],
        now
      )
    ).toEqual([]);
  });

  it("includes the null version id for unversioned objects", () => {
    expect(
      selectExpiredExportArtifactVersions(
        [
          {
            key: "exports/ws/pre-versioning.zip",
            versionId: "null",
            lastModified: old,
          },
        ],
        now
      )
    ).toEqual([{ key: "exports/ws/pre-versioning.zip", versionId: "null" }]);
  });
});
