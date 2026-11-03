import { convexTest } from "convex-test";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import schema from "./schema";
import {
  classifyRecordingObjects,
  ORPHAN_MIN_AGE_MS,
  type RecordingObjectRow,
  type SessionRow,
} from "./audit/recordingsBucketReconciliation";

const modules = import.meta.glob("./**/*.ts");
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function obj(fileName: string, ageMs = 0, fileId = `file_${fileName}`): RecordingObjectRow {
  return {
    fileId,
    fileName,
    contentLength: 1024,
    uploadTimestamp: NOW - ageMs,
  };
}

function session(
  id: string,
  status: SessionRow["status"],
  recordingUrl?: string,
  expiresAt?: number
): SessionRow {
  return {
    sessionId: id as SessionRow["sessionId"],
    status,
    recordingUrl,
    expiresAt,
  };
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
    const result = classifyRecordingObjects(
      [obj(key)],
      // markRecordingDeleted clears recordingUrl, so only the session id links them.
      [session("s1", "purged")],
      NOW
    );
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]).toMatchObject({
      kind: "purged_but_present",
      key,
      deletable: true,
    });
  });

  it("skips pending/uploading/failed rows so it never deletes an in-flight transfer", () => {
    const keys = ["recordings/s1/a.mp4", "recordings/s2/b.mp4", "recordings/s3/c.mp4"];
    const result = classifyRecordingObjects(
      keys.map((k) => obj(k, 30 * DAY)),
      [
        session("s1", "pending"),
        session("s2", "uploading"),
        session("s3", "failed"),
      ],
      NOW
    );
    expect(result.drift).toHaveLength(0);
    expect(result.skippedInFlight).toBe(3);
  });

  it("never deletes the object of a failed transfer (the only copy that survives)", () => {
    // A failed row has no `recordingUrl`, so an earlier implementation
    // dropped it from the session map entirely and deleted its object as
    // an "orphan" after 7 days — destroying the only copy.
    const result = classifyRecordingObjects(
      [obj("recordings/s1/rec1.mp4", 30 * DAY)],
      [session("s1", "failed")],
      NOW
    );
    expect(result.drift).toHaveLength(0);
    expect(result.skippedInFlight).toBe(1);
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
    expect(result.drift[0]).toMatchObject({ kind: "orphan", key: duplicate, deletable: true });
  });

  it("does not delete a very recent orphan (possible in-flight attach)", () => {
    const result = classifyRecordingObjects(
      [obj("recordings/s9/rec9.mp4", DAY)],
      [],
      NOW
    );
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
    const result = classifyRecordingObjects([], [session("s1", "purged")], NOW);
    expect(result.drift).toHaveLength(0);
  });
});

describe("getSessionsByIds", () => {
  it("returns failed rows that have no recordingUrl", async () => {
    const t = convexTest(schema, modules);
    const sessionId = await t.run(async (ctx) => {
      const instructorId = await ctx.db.insert("instructors", {
        userId: "user_instructor",
        email: "instructor@example.com",
        slug: "test-instructor",
        name: "Test Instructor",
      } as never);
      return await ctx.db.insert("sessions", {
        instructorId,
        studentId: "user_student",
        scheduledAt: NOW,
        status: "completed",
        recordingConsent: true,
        recordingTransferStatus: "failed",
      });
    });

    const rows = await t.query(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import("./_generated/api")).internal.audit
        .recordingsBucketReconciliation.getSessionsByIds as any,
      { ids: [sessionId] }
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "failed" });
    expect(rows[0].recordingUrl).toBeUndefined();
  });
});

describe("reconcileRecordingsBucket action", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.RECORDINGS_BUCKET_NAME = "mentorship-call-storage";
    process.env.B2_KEY_ID = "key-id";
    process.env.B2_APPLICATION_KEY = "app-key";
    delete process.env.RESEND_API_KEY; // keep the alert path out of this test
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("deletes a purged-but-present object and reports it", async () => {
    const t = convexTest(schema, modules);

    // One purged session whose object is still in the bucket.
    const sessionId = await t.run(async (ctx) => {
      const instructorId = await ctx.db.insert("instructors", {
        userId: "user_instructor",
        email: "instructor@example.com",
        slug: "test-instructor",
        name: "Test Instructor",
      } as never);
      return await ctx.db.insert("sessions", {
        instructorId,
        studentId: "user_student",
        scheduledAt: NOW,
        status: "completed",
        recordingConsent: true,
        instructorRecordingConsent: true,
        recordingTransferStatus: "purged",
      });
    });

    const key = `recordings/${sessionId}/rec-1.mp4`;
    const calls: string[] = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url.split("/b2api/")[1] ?? url}`);

      if (url.includes("b2_authorize_account")) {
        return new Response(
          JSON.stringify({
            accountId: "acct",
            authorizationToken: "token",
            apiInfo: { storageApi: { apiUrl: "https://api005.example" } },
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("b2_list_buckets")) {
        return new Response(
          JSON.stringify({
            buckets: [{ bucketName: "mentorship-call-storage", bucketId: "bucket-id" }],
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("b2_list_file_names")) {
        return new Response(
          JSON.stringify({
            files: [
              {
                fileId: "file-1",
                fileName: key,
                contentLength: 2048,
                uploadTimestamp: NOW - 10 * DAY,
              },
            ],
            nextFileName: null,
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("b2_delete_file_version")) {
        return new Response("{}", { status: 200 });
      }
      return new Response("unexpected", { status: 500 });
    }) as unknown as typeof fetch;

    const result = await t.action(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import("./_generated/api")).internal.audit
        .recordingsBucketReconciliation.reconcileRecordingsBucket as any,
      {}
    );

    expect(result).toMatchObject({
      drift: 1,
      purgedButPresent: 1,
      deleted: 1,
      deleteFailures: 0,
      alert: "skipped",
    });
    expect(calls.some((c) => c.endsWith("b2_delete_file_version"))).toBe(true);
  });
});
