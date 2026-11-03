import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

// Keep the real `getRecordingsBucketName` (so the missing-env test
// exercises production code, not a copy of it) and stub only the SDK
// client.
vi.mock("./client", async () => {
  const actual = await vi.importActual<typeof import("./client")>("./client");
  return {
    ...actual,
    getB2Client: () => ({ send: sendMock }),
  };
});

const signMock = vi.hoisted(() => vi.fn().mockResolvedValue("https://signed.example/x"));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: signMock }));

import {
  deleteRecordingFromB2,
  getRecordingDownloadUrl,
  getRecordingStreamUrl,
  headRecordingFile,
  uploadRecordingFromUrl,
} from "./recordings";

const REC_BUCKET = "mentorship-call-storage";
const KEY = "recordings/kd7abc/rec-1.mp4";

beforeEach(() => {
  process.env.RECORDINGS_BUCKET_NAME = REC_BUCKET;
  sendMock.mockReset();
  signMock.mockClear();
});

afterEach(() => {
  delete process.env.RECORDINGS_BUCKET_NAME;
});

describe("recording bucket resolution", () => {
  it("throws instead of falling back when RECORDINGS_BUCKET_NAME is unset", async () => {
    // The whole point of the split: a runtime without the env var must
    // fail loudly, not silently write to B2_BUCKET_NAME.
    delete process.env.RECORDINGS_BUCKET_NAME;
    await expect(getRecordingStreamUrl(KEY, "video/mp4")).rejects.toThrow(
      /RECORDINGS_BUCKET_NAME is not set/
    );
    // Prove the real resolver ran, not a mock: the production message
    // mentions the forbidden fallback.
    await expect(deleteRecordingFromB2(KEY)).rejects.toThrow(
      /must not fall back to B2_BUCKET_NAME/
    );
  });
});

describe("recording key guard", () => {
  it("rejects keys outside the recordings/ namespace", async () => {
    await expect(
      getRecordingStreamUrl("2026-10-27/workspaces/ws/image.png", "image/png")
    ).rejects.toThrow(/must start with "recordings\/"/);
    await expect(deleteRecordingFromB2("bulk-downloads/x.zip")).rejects.toThrow(
      /must start with "recordings\/"/
    );
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("recording object operations target the recordings bucket", () => {
  it("signs stream and download URLs against RECORDINGS_BUCKET_NAME", async () => {
    await getRecordingStreamUrl(KEY, "video/mp4");
    const streamCmd = signMock.mock.calls[0][1];
    expect(streamCmd.input.Bucket).toBe(REC_BUCKET);
    expect(streamCmd.input.Key).toBe(KEY);

    await getRecordingDownloadUrl(KEY, "Session.mp4");
    const downloadCmd = signMock.mock.calls[1][1];
    expect(downloadCmd.input.Bucket).toBe(REC_BUCKET);
    expect(downloadCmd.input.ResponseContentDisposition).toContain("Session.mp4");
  });

  it("deletes from the recordings bucket", async () => {
    await deleteRecordingFromB2(KEY);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].input).toMatchObject({
      Bucket: REC_BUCKET,
      Key: KEY,
    });
  });

  it("HEADs the recording in the recordings bucket", async () => {
    sendMock.mockResolvedValue({
      ContentLength: 123,
      ContentType: "video/mp4",
      LastModified: new Date(),
      ETag: '"abc"',
    });
    const meta = await headRecordingFile(KEY);
    expect(meta?.size).toBe(123);
    expect(sendMock.mock.calls[0][0].input).toMatchObject({
      Bucket: REC_BUCKET,
      Key: KEY,
    });
  });
});

describe("uploadRecordingFromUrl", () => {
  it("puts the object into the recordings bucket", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("video-bytes"));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: { "content-length": "11" },
        })
      )
    );
    sendMock.mockResolvedValue({ ETag: '"etag"', VersionId: "v1" });

    await uploadRecordingFromUrl({
      sourceUrl: "https://daily.example/rec.mp4",
      key: KEY,
      contentType: "video/mp4",
    });

    expect(sendMock.mock.calls[0][0].input).toMatchObject({
      Bucket: REC_BUCKET,
      Key: KEY,
    });
    vi.unstubAllGlobals();
  });
});
