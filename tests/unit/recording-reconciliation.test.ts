import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../../convex/schema";
import {
  classifyRecordingObjects,
  ORPHAN_MIN_AGE_MS,
  type ReconSessionRow,
  type RecordingObject,
} from "../../src/trigger/lib/recording-reconciliation";

const modules = import.meta.glob("../../convex/**/*.ts");
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function obj(key: string, ageMs = 0, size = 1024): RecordingObject {
  return { key, size, lastModified: NOW - ageMs };
}

function session(
  id: string,
  status: ReconSessionRow["status"],
  recordingUrl?: string,
  expiresAt?: number
): ReconSessionRow {
  return { sessionId: id, status, recordingUrl, expiresAt };
}

describe("classifyRecordingObjects", () => {
  it("treats an attached, in-date recording as healthy", () => {
    const key = "recordings/s1/rec1.mp4";
    const result = classifyRecordingObjects(
      [obj(key)],
      [session("s1", "ready", key, NOW + DAY)],
      NOW
    );
    expect(result.drift).toHaveLength(0);
    expect(result.healthy).toBe(1);
  });

  it("flags a purged session whose object still exists, and allows the delete", () => {
    const key = "recordings/s1/rec1.mp4";
    // markRecordingDeleted clears recordingUrl, so only the key's session
    // segment links the two.
    const result = classifyRecordingObjects([obj(key)], [session("s1", "purged")], NOW);
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]).toMatchObject({
      kind: "purged_but_present",
      key,
      deletable: true,
    });
  });

  it("never deletes the object of a failed transfer (the only surviving copy)", () => {
    const result = classifyRecordingObjects(
      [obj("recordings/s1/rec1.mp4", 30 * DAY)],
      [session("s1", "failed")],
      NOW
    );
    expect(result.drift).toHaveLength(0);
    expect(result.skippedInFlight).toBe(1);
  });

  it("skips pending/uploading rows so it never races an in-flight transfer", () => {
    const result = classifyRecordingObjects(
      ["recordings/s1/a.mp4", "recordings/s2/b.mp4"].map((k) => obj(k, 30 * DAY)),
      [session("s1", "pending"), session("s2", "uploading")],
      NOW
    );
    expect(result.drift).toHaveLength(0);
    expect(result.skippedInFlight).toBe(2);
  });

  it("reports (but does not delete) an expired recording the daily cleanup missed", () => {
    const key = "recordings/s1/rec1.mp4";
    const result = classifyRecordingObjects(
      [obj(key, 40 * DAY)],
      [session("s1", "ready", key, NOW - DAY)],
      NOW
    );
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]).toMatchObject({
      kind: "expired_not_purged",
      deletable: false,
    });
  });

  it("treats a duplicate key on a ready session as an orphan", () => {
    const attached = "recordings/s1/rec1.mp4";
    const duplicate = "recordings/s1/rec2.mp4";
    const result = classifyRecordingObjects(
      [obj(attached, DAY), obj(duplicate, 10 * DAY)],
      [session("s1", "ready", attached, NOW + DAY)],
      NOW
    );
    expect(result.healthy).toBe(1);
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]).toMatchObject({
      kind: "orphan",
      key: duplicate,
      deletable: true,
    });
  });

  it("does not delete a very recent orphan (possible in-flight attach)", () => {
    const result = classifyRecordingObjects([obj("recordings/s9/rec9.mp4", DAY)], [], NOW);
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0].deletable).toBe(false);
  });

  it("deletes an orphan older than the age gate", () => {
    const result = classifyRecordingObjects(
      [obj("recordings/s9/rec9.mp4", ORPHAN_MIN_AGE_MS + DAY)],
      [],
      NOW
    );
    expect(result.drift[0].deletable).toBe(true);
  });

  it("is clean when every purged row has no object", () => {
    expect(classifyRecordingObjects([], [session("s1", "purged")], NOW).drift).toHaveLength(0);
  });
});

describe("GET /recordings-reconciliation/sessions", () => {
  const KEY = "test-http-key-recon";

  afterEach(() => {
    delete process.env.CONVEX_HTTP_KEY;
    vi.unstubAllEnvs();
  });

  it("rejects an unauthenticated request", async () => {
    process.env.CONVEX_HTTP_KEY = KEY;
    const t = convexTest(schema, modules);
    const response = await t.fetch("/recordings-reconciliation/sessions", { method: "GET" });
    expect(response.status).toBe(401);
  });

  it("returns failed rows without a recordingUrl so their objects are not treated as orphans", async () => {
    process.env.CONVEX_HTTP_KEY = KEY;
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const instructorId = await ctx.db.insert("instructors", {
        userId: "user_instructor",
        email: "instructor@example.com",
        slug: "test-instructor",
        name: "Test Instructor",
      } as never);
      await ctx.db.insert("sessions", {
        instructorId,
        studentId: "user_student",
        scheduledAt: NOW,
        status: "completed",
        recordingConsent: true,
        recordingTransferStatus: "failed",
      });
    });

    const response = await t.fetch("/recordings-reconciliation/sessions", {
      method: "GET",
      headers: { Authorization: `Bearer ${KEY}` },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sessions: Array<{ status?: string; recordingUrl?: string }>;
      count: number;
    };
    expect(body.count).toBe(1);
    expect(body.sessions[0]).toMatchObject({ status: "failed" });
    expect(body.sessions[0].recordingUrl).toBeUndefined();
  });
});
