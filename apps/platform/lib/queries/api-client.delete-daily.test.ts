import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteDailyRecording } from "./api-client";

describe("deleteDailyRecording", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to the delete-daily route", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, attemptNumber: 2 }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        })
      );

    const result = await deleteDailyRecording("session_123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/video/recording/session_123/delete-daily");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(result).toMatchObject({ ok: true, attemptNumber: 2 });
  });
});
