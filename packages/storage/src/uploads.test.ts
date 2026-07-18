import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@aws-sdk/client-s3", async () => {
  const actual = await vi.importActual<typeof import("@aws-sdk/client-s3")>(
    "@aws-sdk/client-s3"
  );
  return actual;
});

const mockSend = vi.fn();
const mockGetB2Client = vi.fn(() => ({ send: mockSend }));

vi.mock("./client", () => ({
  getB2Client: () => mockGetB2Client(),
  B2_BUCKET_NAME: "instructor-uploads",
  B2_BUCKET_REGION: "us-west-002",
}));

import { uploadFromUrl } from "./uploads";

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

  it("streams the source URL into a PutObjectCommand against the B2 bucket", async () => {
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

  it("throws when the source URL returns non-2xx", async () => {
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

  it("rejects oversized source before streaming", async () => {
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

  it("throws when the source response has no body", async () => {
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

  it("enforces maxBytes while streaming a chunked (no Content-Length) source", async () => {
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

  it("returns the streamed byte count when Content-Length is absent", async () => {
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
