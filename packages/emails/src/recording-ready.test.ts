import { beforeEach, describe, expect, it } from "vitest";
import { buildAdHocCallInviteEmail } from "./ad-hoc-call";
import { buildRecordingReadyEmail } from "./recording-ready";

// PR-E (Issue 5): `recording-ready.ts` did not previously have a
// unit test (flagged in the plan). This file pins:
//   1. The email composition contract (subject, text, html, headers).
//   2. The PR-E wrap-through-/auth-redirect contract — the
//      destination must survive the signed-out → signed-in bounce.
// Mirror of `ad-hoc-call.test.ts` with a `?videos=` payload rather
// than `?join=`, so future drift between the two surfaces is caught
// here rather than in prod.

const BASE_URL = "https://app.huckleberry-art.dev";
const innerPath = "/workspace/ws_abc123?videos=se_xyz789";
const expectedWrappedUrl =
  "https://app.huckleberry-art.dev/auth-redirect?redirect_url=%2Fworkspace%2Fws_abc123%3Fvideos%3Dse_xyz789";

describe("buildRecordingReadyEmail", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_URL = BASE_URL;
  });

  it("emits the recording-ready subject and headers", () => {
    const result = buildRecordingReadyEmail({
      studentEmail: "ada@example.com",
      studentName: "Ada",
      instructorName: "Sarah Lee",
      workspaceId: "ws_abc123",
      sessionId: "se_xyz789",
    });

    expect(result.subject).toBe("Your session recording is ready to view");
    expect(result.headers["X-Email-Type"]).toBe("recording_ready_student");
    expect(result.headers["X-Email-Session"]).toBe("se_xyz789");
  });

  it("interpolates the greetee name, instructor, and the auth-redirect-wrapped watch link", () => {
    const result = buildRecordingReadyEmail({
      studentEmail: "ada@example.com",
      studentName: "Ada",
      instructorName: "Sarah Lee",
      workspaceId: "ws_abc123",
      sessionId: "se_xyz789",
    });

    expect(result.text).toContain("Hi Ada,");
    expect(result.text).toContain("Instructor: Sarah Lee");
    // PR-E: must route through /auth-redirect, not bare /workspace/?videos=
    expect(result.text).toContain(expectedWrappedUrl);
    expect(result.text).not.toContain(innerPath);

    expect(result.html).toContain("Hi Ada");
    expect(result.html).toContain("Sarah Lee");
    expect(result.html).toContain(expectedWrappedUrl);
    expect(result.html).not.toContain(innerPath);
  });

  it("falls back to 'Hi there,' when the student name is null", () => {
    const result = buildRecordingReadyEmail({
      studentEmail: "ada@example.com",
      studentName: null,
      instructorName: "Sarah Lee",
      workspaceId: "ws_abc123",
      sessionId: "se_xyz789",
    });

    expect(result.text).toContain("Hi there,");
    expect(result.html).toContain("Hi there");
  });

  it("treats whitespace-only name the same as null", () => {
    const result = buildRecordingReadyEmail({
      studentEmail: "ada@example.com",
      studentName: "   ",
      instructorName: "Sarah Lee",
      workspaceId: "ws_abc123",
      sessionId: "se_xyz789",
    });

    expect(result.text).toContain("Hi there,");
    expect(result.text).not.toMatch(/Hi\s+,/);
  });

  it("escapes HTML in greetee and instructor names (defense in depth)", () => {
    const result = buildRecordingReadyEmail({
      studentEmail: "ada@example.com",
      studentName: "<b>Ada</b>",
      instructorName: "Studio & \"Gallery\"",
      workspaceId: "ws_abc123",
      sessionId: "se_xyz789",
    });

    expect(result.html).not.toContain("<b>Ada</b>");
    expect(result.html).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(result.html).toContain("&amp;");
    expect(result.html).toContain("&quot;Gallery&quot;");
    // Plain text preserves raw markup (read-order for text-only
    // mail clients). Safe because plaintext strips HTML on render.
    expect(result.text).toContain("<b>Ada</b>");
  });

  it("encodes the inner /workspace/?videos= path into redirect_url (Issue 5 wrapping)", () => {
    const result = buildRecordingReadyEmail({
      studentEmail: "ada@example.com",
      studentName: "Ada",
      instructorName: "Sarah Lee",
      workspaceId: "ws_abc123",
      sessionId: "se_xyz789",
    });

    expect(result.text).toMatch(
      /Watch the recording: https:\/\/app\.huckleberry-art\.dev\/auth-redirect\?redirect_url=/,
    );
    expect(result.html).toMatch(
      /href="https:\/\/app\.huckleberry-art\.dev\/auth-redirect\?redirect_url=/,
    );
    // Round-trip: decode and confirm the inner path matches.
    const fromText = result.text.match(/redirect_url=([^\s]+)/)?.[1] ?? "";
    expect(decodeURIComponent(fromText)).toBe(innerPath);
  });

  it("uses the same wrapper shape as ad-hoc-call (cross-file symmetry)", () => {
    // Both PR-E email sites use `buildAuthRedirectUrl`. Pin that
    // they produce structurally identical URLs (only the query
    // keyword `videos`/`join` differs).
    const recording = buildRecordingReadyEmail({
      studentEmail: "ada@example.com",
      studentName: "Ada",
      instructorName: "Sarah Lee",
      workspaceId: "ws_abc123",
      sessionId: "se_xyz789",
    });
    const adHoc = buildAdHocCallInviteEmail({
      callerName: "Sarah Lee",
      callerRole: "instructor",
      workspaceName: "Acrylic",
      workspaceId: "ws_abc123",
      sessionId: "se_xyz789",
    });

    const recordingPayload = decodeURIComponent(
      recording.text.match(/redirect_url=([^\s]+)/)?.[1] ?? "",
    );
    const adHocPayload = decodeURIComponent(
      adHoc.text.match(/redirect_url=([^\s]+)/)?.[1] ?? "",
    );
    // Both should sit at the same path with the same schema.
    expect(recordingPayload.startsWith("/workspace/ws_abc123?")).toBe(true);
    expect(adHocPayload.startsWith("/workspace/ws_abc123?")).toBe(true);
    // And the only variation is the keyword.
    expect(recordingPayload.replace("videos", "<K>")).toBe(
      adHocPayload.replace("join", "<K>"),
    );
  });
});
