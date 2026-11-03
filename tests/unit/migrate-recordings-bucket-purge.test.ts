import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for `--apply --purge-probes` (PR #991).
 *
 * The bug: an early `return` after the probe loop meant the probes were
 * deleted and the recording migration was silently skipped. The script
 * still exited 0 and printed nothing useful, so it looked successful.
 *
 * The S3 SDK is stubbed so `main()` runs end to end without network I/O.
 */

type FakeCommand = { kind: string; input: Record<string, unknown> };

const state = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class Fake {
    kind = "unknown";
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  const make = (kind: string) =>
    class extends Fake {
      constructor(input: Record<string, unknown>) {
        super(input);
        this.kind = kind;
      }
    };
  return {
    S3Client: class {
      send = state.send;
    },
    ListObjectsV2Command: make("list"),
    HeadObjectCommand: make("head"),
    CopyObjectCommand: make("copy"),
    DeleteObjectCommand: make("delete"),
  };
});

import { main } from "../../scripts/migrate-recordings-bucket";

const SOURCE = "instructor-uploads";
const TARGET = "mentorship-call-storage";
const REC_KEY = "recordings/kd7abc/rec-1.mp4";
const PROBE_KEY = "test-size-bound-1790652011517.txt";

function mockStorage(options: { recordings: string[] }) {
  const copied = new Set<string>();
  const calls: Array<{ kind: string; bucket: string; key: string }> = [];

  state.send.mockImplementation(async (cmd: FakeCommand) => {
    const bucket = String(cmd.input.Bucket);
    const key = String(cmd.input.Key ?? "");
    switch (cmd.kind) {
      case "list": {
        const prefix = String(cmd.input.Prefix ?? "");
        if (prefix.startsWith("test-size-bound-")) {
          return {
            Contents: [{ Key: PROBE_KEY, Size: 12 }],
            IsTruncated: false,
          };
        }
        return {
          Contents: options.recordings.map((k) => ({ Key: k, Size: 1000 })),
          IsTruncated: false,
        };
      }
      case "head": {
        if (bucket === TARGET && !copied.has(key)) {
          const err = new Error("not found");
          err.name = "NotFound";
          throw err;
        }
        return { ContentLength: 1000 };
      }
      case "copy":
        copied.add(key);
        calls.push({ kind: "copy", bucket, key });
        return {};
      case "delete":
        calls.push({ kind: "delete", bucket, key });
        return {};
      default:
        return {};
    }
  });

  return calls;
}

beforeEach(() => {
  process.env.B2_KEY_ID = "test-key-id";
  process.env.B2_APPLICATION_KEY = "test-app-key";
  process.env.B2_REGION = "us-east-005";
  process.env.B2_ENDPOINT = "https://s3.us-east-005.backblazeb2.com";
  process.env.RECORDINGS_BUCKET_NAME = TARGET;
  delete process.env.LEGACY_RECORDINGS_SOURCE_BUCKET;
  state.send.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("migrate-recordings-bucket --apply --purge-probes", () => {
  it("purges probes AND migrates every recording", async () => {
    const calls = mockStorage({ recordings: [REC_KEY] });
    process.argv = ["node", "script", "--apply", "--purge-probes"];

    await main();

    // Probe removed...
    expect(calls).toContainEqual({ kind: "delete", bucket: TARGET, key: PROBE_KEY });
    // ...and the recording was still copied then removed from the source.
    expect(calls).toContainEqual({ kind: "copy", bucket: TARGET, key: REC_KEY });
    expect(calls).toContainEqual({ kind: "delete", bucket: SOURCE, key: REC_KEY });
  });

  it("migrates without --purge-probes", async () => {
    const calls = mockStorage({ recordings: [REC_KEY] });
    process.argv = ["node", "script", "--apply"];

    await main();

    expect(calls).toContainEqual({ kind: "copy", bucket: TARGET, key: REC_KEY });
    expect(calls.some((c) => c.key === PROBE_KEY)).toBe(false);
  });
});
