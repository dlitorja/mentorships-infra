import { describe, expect, it } from "vitest";
import {
  CONVEX_BACKUP_RETENTION_DAYS,
  buildConvexBackupKey,
  convexBackupPrefix,
  formatBackupTimestamp,
  parseConvexBackupKey,
  selectExpiredConvexBackupVersions,
} from "./convex-backups";

describe("buildConvexBackupKey", () => {
  it("lays out the timestamp under deployment/year/month/day", () => {
    const timestamp = Date.UTC(2026, 10, 19, 2, 0, 0, 0);
    const key = buildConvexBackupKey("fine-bulldog-260", timestamp);

    expect(key.zipKey).toBe(
      "convex-backups/fine-bulldog-260/2026/11/19/20261119T020000000Z.zip"
    );
    expect(key.manifestKey).toBe(
      "convex-backups/fine-bulldog-260/2026/11/19/20261119T020000000Z.manifest.json"
    );
    expect(convexBackupPrefix("fine-bulldog-260")).toBe(
      "convex-backups/fine-bulldog-260/"
    );
  });
});

describe("parseConvexBackupKey", () => {
  it("round-trips the timestamp", () => {
    const timestamp = Date.UTC(2026, 10, 19, 2, 3, 4, 5);
    const key = buildConvexBackupKey("deployment-1", timestamp);

    expect(parseConvexBackupKey(key.zipKey)).toEqual({
      deployment: "deployment-1",
      timestamp,
      isManifest: false,
      fileName: "20261119T020304005Z.zip",
    });
    expect(parseConvexBackupKey(key.manifestKey)?.isManifest).toBe(true);
  });

  it("rejects unrelated keys and malformed timestamps", () => {
    expect(parseConvexBackupKey("exports/ws/file.zip")).toBeNull();
    expect(
      parseConvexBackupKey("convex-backups/prod/2026/11/19/not-a-time.zip")
    ).toBeNull();
    expect(parseConvexBackupKey("convex-backups/prod/2026/11/19/x.zip")).toBeNull();
  });

  it("matches the formatter output", () => {
    expect(formatBackupTimestamp(Date.UTC(2026, 0, 2, 3, 4, 5, 6))).toBe(
      "20260102T030405006Z"
    );
  });
});

describe("selectExpiredConvexBackupVersions", () => {
  const now = Date.UTC(2026, 5, 1);
  const old = Date.UTC(2026, 0, 1);
  const recent = Date.UTC(2026, 4, 1);

  function versionFor(deployment: string, timestamp: number, extra = "zip") {
    const key = buildConvexBackupKey(deployment, timestamp);
    return {
      key: extra === "zip" ? key.zipKey : key.manifestKey,
      versionId: `v-${deployment}-${timestamp}-${extra}`,
      lastModified: timestamp,
    };
  }

  it("deletes zip and manifest versions past retention", () => {
    const expired = selectExpiredConvexBackupVersions(
      [
        versionFor("prod", old, "zip"),
        versionFor("prod", old, "manifest"),
        versionFor("prod", recent, "zip"),
      ],
      now,
      { retentionDays: CONVEX_BACKUP_RETENTION_DAYS, minKeep: 1 }
    );

    expect(expired).toHaveLength(2);
    expect(expired.map((v) => v.versionId).sort()).toEqual([
      `v-prod-${old}-manifest`,
      `v-prod-${old}-zip`,
    ]);
  });

  it("keeps the newest backups even when all are past retention", () => {
    const ancient = Date.UTC(2025, 0, 1);
    const expired = selectExpiredConvexBackupVersions(
      [
        versionFor("prod", ancient, "zip"),
        versionFor("prod", ancient + 1, "zip"),
        versionFor("prod", ancient + 2, "zip"),
      ],
      now,
      { retentionDays: 1, minKeep: 2 }
    );

    expect(expired.map((v) => v.versionId)).toEqual([
      `v-prod-${ancient}-zip`,
    ]);
  });

  it("scopes retention per deployment", () => {
    const expired = selectExpiredConvexBackupVersions(
      [
        versionFor("prod", old, "zip"),
        versionFor("preview", old, "zip"),
        versionFor("preview", recent, "zip"),
      ],
      now,
      { retentionDays: CONVEX_BACKUP_RETENTION_DAYS, minKeep: 1 }
    );

    // Each deployment keeps its own newest backup: prod's only copy
    // survives the minKeep floor, preview's older copy does not.
    expect(expired.map((v) => v.versionId).sort()).toEqual([
      `v-preview-${old}-zip`,
    ]);
  });

  it("ignores keys outside the backup namespace", () => {
    const expired = selectExpiredConvexBackupVersions(
      [
        { key: "exports/ws/file.zip", versionId: "v1", lastModified: old },
        versionFor("prod", old, "zip"),
      ],
      now,
      { retentionDays: 1, minKeep: 0 }
    );

    expect(expired).toHaveLength(1);
    expect(expired[0].key).toContain("convex-backups/prod/");
  });
});
