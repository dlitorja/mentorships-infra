import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ListPartsCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";

vi.mock("@aws-sdk/client-s3", async () => {
  const actual = await vi.importActual<typeof import("@aws-sdk/client-s3")>(
    "@aws-sdk/client-s3"
  );
  return actual;
});

const mockGetSignedUrl = vi.hoisted(() =>
  vi.fn().mockResolvedValue("https://example.com/presigned-url")
);

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: mockGetSignedUrl,
}));

const mockSend = vi.fn();
const mockGetB2Client = vi.fn(() => ({ send: mockSend }));

vi.mock("./client", () => ({
  getB2Client: () => mockGetB2Client(),
  B2_BUCKET_NAME: "instructor-uploads",
  B2_BUCKET_REGION: "us-west-002",
}));

import { uploadFromUrl, completeMultipartUpload, initiateMultipartUpload } from "./uploads";

const originalFetch = globalThis.fetch;

describe("uploadFromUrl", () => {
  beforeEach(() => {
    process.env.B2_KEY_ID = "test-key";
    process.env.B2_APPLICATION_KEY = "test-app-key";
    process.env.B2_BUCKET_NAME = "instructor-uploads";
    process.env.B2_REGION = "us-west-002";
    mockSend.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("streams the source URL into a PutObjectCommand against the B2 bucket", async (): Promise<void> => {
    const fakeStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": "3" }),
      body: fakeStream,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    mockSend.mockImplementation(async (command) => {
      const body = (command as { input: { Body: ReadableStream<Uint8Array> } })
        .input.Body;
      const reader = body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
      return { ETag: "etag-123", VersionId: "v1" };
    });

    const result = await uploadFromUrl({
      sourceUrl: "https://daily.example/signed",
      key: "recordings/session-abc/1700000000000.mp4",
      contentType: "video/mp4",
    });

    expect(result.etag).toBe("etag-123");
    expect(result.versionId).toBe("v1");
    expect(result.bytes).toBe(3);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0]?.[0] as { input: { Bucket: string; Key: string; ContentType: string } };
    expect(command.input.Bucket).toBe("instructor-uploads");
    expect(command.input.Key).toBe("recordings/session-abc/1700000000000.mp4");
    expect(command.input.ContentType).toBe("video/mp4");
  });

  it("throws when the source URL returns non-2xx", async (): Promise<void> => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      uploadFromUrl({
        sourceUrl: "https://daily.example/signed",
        key: "recordings/x.mp4",
        contentType: "video/mp4",
      })
    ).rejects.toThrow(/Source fetch failed: 403/);
  });

  it("rejects oversized source before streaming", async (): Promise<void> => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": "9999999999" }),
      body: new ReadableStream({ start(c) { c.close(); } }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      uploadFromUrl({
        sourceUrl: "https://daily.example/signed",
        key: "recordings/x.mp4",
        contentType: "video/mp4",
        maxBytes: 1024,
      })
    ).rejects.toThrow(/exceeds maxBytes=1024/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("throws when the source response has no body", async (): Promise<void> => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: null,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      uploadFromUrl({
        sourceUrl: "https://daily.example/signed",
        key: "recordings/x.mp4",
        contentType: "video/mp4",
      })
    ).rejects.toThrow(/no body/);
  });

  it("enforces maxBytes while streaming a chunked (no Content-Length) source", async (): Promise<void> => {
    const chunks = [
      new Uint8Array(600),
      new Uint8Array(600),
    ];
    const fakeStream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: fakeStream,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    mockSend.mockImplementation(async (command) => {
      const body = (command as { input: { Body: ReadableStream<Uint8Array> } })
        .input.Body;
      const reader = body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
      return { ETag: "etag-stream", VersionId: "v1" };
    });

    await expect(
      uploadFromUrl({
        sourceUrl: "https://daily.example/signed",
        key: "recordings/x.mp4",
        contentType: "video/mp4",
        maxBytes: 1000,
      })
    ).rejects.toThrow(/exceeded maxBytes=1000/);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("returns the streamed byte count when Content-Length is absent", async (): Promise<void> => {
    const chunks = [
      new Uint8Array(100),
      new Uint8Array(250),
      new Uint8Array(50),
    ];
    const fakeStream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: fakeStream,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    mockSend.mockImplementation(async (command) => {
      const body = (command as { input: { Body: ReadableStream<Uint8Array> } })
        .input.Body;
      const reader = body.getReader();
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) total += value.byteLength;
      }
      return { ETag: "etag-stream", VersionId: "v2" };
    });

    const result = await uploadFromUrl({
      sourceUrl: "https://daily.example/signed",
      key: "recordings/x.mp4",
      contentType: "video/mp4",
    });

    expect(result.bytes).toBe(400);
    expect(result.etag).toBe("etag-stream");
  });
});

describe("initiateMultipartUpload", () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockGetSignedUrl.mockResolvedValue("https://example.com/presigned-url");
  });

  it("returns upload details after a successful B2 initiate", async (): Promise<void> => {
    mockSend.mockResolvedValue({ UploadId: "upload-123" });

    const result = await initiateMultipartUpload({
      fileId: "file-123",
      filename: "test.mp4",
      contentType: "video/mp4",
      size: 1024,
      instructorId: "instructor-1",
    });

    expect(result.uploadId).toBe("upload-123");
    expect(result.partSize).toBe(100 * 1024 * 1024);
    expect(result.partCount).toBe(1);
    expect(result.presignedUrls).toHaveLength(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable B2 server errors and then succeeds", async (): Promise<void> => {
    const serverError = Object.assign(new Error("Server Error"), { code: "InternalError" });
    mockSend
      .mockRejectedValueOnce(serverError)
      .mockResolvedValueOnce({ UploadId: "upload-123" });

    const result = await initiateMultipartUpload({
      fileId: "file-123",
      filename: "test.mp4",
      contentType: "video/mp4",
      size: 1024,
      instructorId: "instructor-1",
    });

    expect(result.uploadId).toBe("upload-123");
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("does not retry on non-retryable B2 errors", async (): Promise<void> => {
    const clientError = Object.assign(new Error("NoSuchBucket"), { code: "NoSuchBucket" });
    mockSend.mockRejectedValue(clientError);

    await expect(
      initiateMultipartUpload({
        fileId: "file-123",
        filename: "test.mp4",
        contentType: "video/mp4",
        size: 1024,
        instructorId: "instructor-1",
      })
    ).rejects.toThrow("NoSuchBucket");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("throws when the file exceeds the maximum part count", async (): Promise<void> => {
    await expect(
      initiateMultipartUpload({
        fileId: "file-123",
        filename: "test.mp4",
        contentType: "video/mp4",
        size: (200 * 100 * 1024 * 1024) + 1,
        instructorId: "instructor-1",
      })
    ).rejects.toThrow(/Maximum 200 parts allowed/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("aborts the multipart upload when presigned URL generation fails", async (): Promise<void> => {
    mockSend.mockResolvedValue({ UploadId: "upload-123" });
    mockGetSignedUrl.mockRejectedValue(new Error("Presigner failed"));

    await expect(
      initiateMultipartUpload({
        fileId: "file-123",
        filename: "test.mp4",
        contentType: "video/mp4",
        size: 1024,
        instructorId: "instructor-1",
      })
    ).rejects.toThrow("Presigner failed");

    const abortCall = mockSend.mock.calls.find(
      ([c]) => c instanceof AbortMultipartUploadCommand
    );
    expect(abortCall).toBeDefined();
  });
});

describe("completeMultipartUpload", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("uses server-side ETags when the client omits them", async (): Promise<void> => {
    mockSend.mockImplementation(async (command) => {
      if (command instanceof ListPartsCommand) {
        return {
          Parts: [
            { PartNumber: 1, ETag: '"actual-etag-1"' },
            { PartNumber: 2, ETag: '"actual-etag-2"' },
          ],
        };
      }
      if (command instanceof CompleteMultipartUploadCommand) {
        return {
          Location: "https://s3.us-west-002.backblazeb2.com/instructor-uploads/test.mp4",
          ETag: '"final-etag"',
          VersionId: "v1",
        };
      }
      return {};
    });

    const result = await completeMultipartUpload({
      key: "test.mp4",
      uploadId: "upload-123",
      parts: [{ partNumber: 1 }, { partNumber: 2 }],
    });

    expect(result.etag).toBe('"final-etag"');
    expect(result.versionId).toBe("v1");

    const completeCall = mockSend.mock.calls.find(
      ([c]) => c instanceof CompleteMultipartUploadCommand
    );
    expect(completeCall).toBeDefined();
    const completeCommand = completeCall![0] as CompleteMultipartUploadCommand;
    expect(completeCommand.input.MultipartUpload?.Parts).toEqual([
      { PartNumber: 1, ETag: '"actual-etag-1"' },
      { PartNumber: 2, ETag: '"actual-etag-2"' },
    ]);
  });

  it("throws a descriptive error when a part is missing and no client ETag is provided", async (): Promise<void> => {
    mockSend.mockImplementation(async (command) => {
      if (command instanceof ListPartsCommand) {
        // B2 only knows about part 1; part 2 is missing
        return { Parts: [{ PartNumber: 1, ETag: '"actual-etag-1"' }] };
      }
      return {};
    });

    await expect(
      completeMultipartUpload({
        key: "test.mp4",
        uploadId: "upload-123",
        parts: [{ partNumber: 1 }, { partNumber: 2 }],
      })
    ).rejects.toThrow(/Part 2 was not found in B2's ListParts response/);
  });

  it("succeeds when B2 omits the final ETag in the completion response", async (): Promise<void> => {
    mockSend.mockImplementation(async (command) => {
      if (command instanceof ListPartsCommand) {
        return { Parts: [{ PartNumber: 1, ETag: '"actual-etag-1"' }] };
      }
      if (command instanceof CompleteMultipartUploadCommand) {
        // B2 can finalize the object without returning an ETag header.
        return { Location: "https://example.com/test.mp4", VersionId: "v1" };
      }
      return {};
    });

    const result = await completeMultipartUpload({
      key: "test.mp4",
      uploadId: "upload-123",
      parts: [{ partNumber: 1 }],
    });

    expect(result.location).toBe("https://example.com/test.mp4");
    expect(result.etag).toBe("");
    expect(result.versionId).toBe("v1");
  });

  it("throws when B2 omits the Location in the completion response", async (): Promise<void> => {
    mockSend.mockImplementation(async (command) => {
      if (command instanceof ListPartsCommand) {
        return { Parts: [{ PartNumber: 1, ETag: '"actual-etag-1"' }] };
      }
      if (command instanceof CompleteMultipartUploadCommand) {
        return { ETag: '"final-etag"', VersionId: "v1" };
      }
      return {};
    });

    await expect(
      completeMultipartUpload({
        key: "test.mp4",
        uploadId: "upload-123",
        parts: [{ partNumber: 1 }],
      })
    ).rejects.toThrow(/B2 returned no Location/);
  });
});
