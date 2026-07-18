import type { Id } from "@/convex/_generated/dataModel";
import { z } from "zod";

const DEFAULT_DAILY_API_URL = "https://api.daily.co/v1";

/**
 * Default Daily subdomain tied to our account configuration. Mirrors the
 * `DAILY_API_URL` fallback pattern in this file: an in-code constant is
 * used unless `NEXT_PUBLIC_DAILY_DOMAIN` overrides it (e.g. staging
 * preview). This keeps join URLs stable across deployments that don't
 * set the env var explicitly, instead of crashing at request time.
 */
export const DEFAULT_DAILY_DOMAIN = "huckleberryartinc.daily.co";

/**
 * Recording max length in seconds (matches `eject_after_elapsed`).
 * Daily auto-ejects participants at this point, capping cloud recording
 * duration at 4 hours.
 */
export const DAILY_MAX_RECORDING_SECONDS = 4 * 60 * 60;

/**
 * Room expiry window in seconds. Daily will reject joins after this
 * timestamp; combined with `eject_at_room_exp` this also kicks out
 * anyone still in the room.
 */
export const DAILY_ROOM_EXPIRY_SECONDS = 24 * 60 * 60;

export type CreateMeetingTokenInput = {
  roomName: string;
  userId: string;
  userName: string;
  isOwner: boolean;
  ttlSeconds: number;
};

export type DailyRoom = {
  roomName: string;
  roomUrl: string;
};

type DailyAccessLinkResponse = {
  download_url?: string;
  url?: string;
};

const dailyAccessLinkResponseSchema = z.object({
  download_url: z.string().optional(),
  url: z.string().optional(),
});

/**
 * Thrown for any non-2xx response from the Daily REST API. Includes the
 * HTTP status and the Daily error type (`error`) + human-readable detail
 * (`info`) so callers can distinguish 401 (bad API key) from 429 (rate
 * limited) from 5xx (transient) without parsing strings.
 */
export class DailyApiError extends Error {
  readonly statusCode: number;
  readonly errorType: string | undefined;
  readonly info: string | undefined;

  constructor(params: {
    statusCode: number;
    message: string;
    errorType?: string;
    info?: string;
  }) {
    super(params.message);
    this.name = "DailyApiError";
    this.statusCode = params.statusCode;
    this.errorType = params.errorType;
    this.info = params.info;
    Object.setPrototypeOf(this, DailyApiError.prototype);
  }
}

function getDailyConfig(): { apiKey: string; baseUrl: string } {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    throw new Error("DAILY_API_KEY is not configured");
  }
  const baseUrl = process.env.DAILY_API_URL ?? DEFAULT_DAILY_API_URL;
  return { apiKey, baseUrl };
}

async function dailyFetch(
  path: string,
  init: RequestInit
): Promise<Response> {
  const { apiKey, baseUrl } = getDailyConfig();
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers ?? {}),
    },
  });
}

type DailyErrorBody = {
  error?: string;
  info?: string;
};

const dailyRoomResponseSchema = z.object({
  name: z.string(),
  url: z.string(),
});

async function parseDailyRoomResponse(
  response: Response
): Promise<DailyRoom> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new DailyApiError({
      statusCode: response.status,
      message: "Daily response was not valid JSON",
    });
  }
  const parsed = dailyRoomResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DailyApiError({
      statusCode: response.status,
      message: "Daily room response missing name or url",
    });
  }
  return { roomName: parsed.data.name, roomUrl: parsed.data.url };
}

function isDailyErrorBody(value: unknown): value is DailyErrorBody {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (obj.error !== undefined && typeof obj.error !== "string") return false;
  if (obj.info !== undefined && typeof obj.info !== "string") return false;
  return true;
}

async function parseErrorResponse(response: Response): Promise<DailyApiError> {
  let body: DailyErrorBody = {};
  try {
    const parsed: unknown = await response.json();
    if (isDailyErrorBody(parsed)) {
      body = parsed;
    }
  } catch {
    // Non-JSON body — leave body empty.
  }
  const detail = body.info ?? body.error ?? response.statusText;
  return new DailyApiError({
    statusCode: response.status,
    message: `Daily API ${response.status}: ${detail}`,
    errorType: body.error,
    info: body.info,
  });
}

/**
 * Stable room name derived from a session id. PR #1 added a
 * `by_videoRoomName` index on `sessions` keyed off this exact string,
 * so the format MUST stay `mentorship-{sessionId}`.
 */
export function videoRoomNameForSession(sessionId: Id<"sessions">): string {
  return `mentorship-${sessionId}`;
}

/**
 * Creates a new Daily room for a session. The room is private
 * (token-gated), configured for two participants, with screen-share
 * and (optionally) cloud recording enabled. The room expires 24h after
 * creation and participants are auto-ejected at 4h (matching the
 * recording cap).
 *
 * `recordingEnabled` MUST be passed explicitly: passing `true` enables
 * Daily cloud recording (used by PR #1's webhook to attach metadata);
 * passing `false` disables it. The caller is responsible for any
 * consent check — recording consent is a PR #4 feature and will gate
 * this flag at the route layer once the session-level consent field
 * lands. For PR #2 the rooms route passes `true` (current behavior).
 *
 * Idempotency is enforced at the caller level: this helper always
 * creates a new room. The route handler is responsible for checking
 * `sessions.videoRoomName` before calling, and for handling a 409
 * from Daily (room already exists) by reusing the existing room.
 */
export async function createDailyRoom(
  sessionId: Id<"sessions">,
  options: { recordingEnabled: boolean }
): Promise<DailyRoom> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const response = await dailyFetch("/rooms", {
    method: "POST",
    body: JSON.stringify({
      name: videoRoomNameForSession(sessionId),
      privacy: "private",
      properties: {
        enable_chat: false,
        enable_screenshare: true,
        enable_recording: options.recordingEnabled ? "cloud" : "off",
        enable_emoji_reactions: true,
        enable_hand_raising: true,
        // PR #4a: turn on Daily's built-in waiting room so a student
        // who arrives while the instructor is already in the call
        // lands in the lobby instead of being rejected by
        // `max_participants: 2`. Owner-role meeting tokens (issued to
        // the instructor per PR #2) bypass the lobby automatically,
        // so the first-to-join instructor enters the room directly.
        enable_knocking: true,
        // 1:1 mentorship — capped at 2 participants to prevent
        // uninvited observers. Trade-off: a user who disconnects on
        // a flaky network may need to wait briefly for Daily's stale
        // session to be evicted before they can rejoin; the 4h
        // eject_after_elapsed also bounds the window. Acceptable for
        // the mentorship use case; revisit if rejoin complaints surface.
        max_participants: 2,
        exp: nowSeconds + DAILY_ROOM_EXPIRY_SECONDS,
        eject_at_room_exp: true,
        eject_after_elapsed: DAILY_MAX_RECORDING_SECONDS,
      },
    }),
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return await parseDailyRoomResponse(response);
}

/**
 * Deletes a Daily room. The PR #2 end-call endpoint deliberately does
 * NOT call this — leaving the room up lets the recording webhook fire
 * (Daily erases recordings 7 days after room deletion). This helper
 * exists so a future cleanup cron / admin tool can reap stale rooms.
 */
export async function deleteDailyRoom(roomName: string): Promise<void> {
  const encoded = encodeURIComponent(roomName);
  const response = await dailyFetch(`/rooms/${encoded}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }
}

/**
 * Updates an existing Daily room's properties. Used by PR #4a's consent
 * reconciliation flow: when a participant records their consent AFTER
 * the room was already provisioned (e.g., the student declines after
 * the instructor already joined), `enable_recording` may need to flip
 * from `"cloud"` to `"off"` so the call isn't recorded against the
 * declining party's wishes. Daily's room-update endpoint is
 * `POST /v1/rooms/{name}` (NOT PATCH) — the `method: "POST"` below
 * is correct; do not "fix" it to PATCH or the update will 404.
 *
 * Only `properties` is updatable here — privacy, exp, eject, and the
 * other non-property fields are immutable post-creation.
 */
export async function patchDailyRoomProperties(
  roomName: string,
  properties: Record<string, unknown>
): Promise<void> {
  const encoded = encodeURIComponent(roomName);
  const response = await dailyFetch(`/rooms/${encoded}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ properties }),
  });
  if (!response.ok) {
    throw await parseErrorResponse(response);
  }
}

/**
 * Creates a Daily room for a session, with 409-recovery: if Daily
 * reports the room already exists (the stable name from
 * `videoRoomNameForSession` collides with a prior partial-failure),
 * look it up, reconcile its `enable_recording` to match the desired
 * state, and reuse it. Extracted from the rooms/start-adhoc routes
 * so the retry logic lives in one place — both flows need it.
 *
 * Why the PATCH-on-409 step: when a previous attempt crashed between
 * `createDailyRoom` and `setVideoRoom`, the Daily room exists with
 * whatever `enable_recording` was used at that time. If consent
 * changed between the failed attempt and the retry (e.g., the user
 * dismissed and re-opened the consent modal with a different choice),
 * the room's `enable_recording` would diverge from the new desired
 * state. Reconciling here keeps `setVideoRoom`'s `roomRecordingEnabled`
 * snapshot consistent with the real Daily room.
 *
 * The PATCH is best-effort: a failure here logs but does NOT abort
 * the resolution. The user can still join the existing room with its
 * current recording setting; `syncRoomRecording` will reconcile later
 * when either party records a fresh consent choice (which keeps the
 * drift detector armed).
 *
 * Returns the `{ roomName, roomUrl }` pair to persist via
 * `setVideoRoom`. `recordingEnabled` is forwarded to
 * `createDailyRoom`.
 */
export async function resolveDailyRoom(
  sessionId: Id<"sessions">,
  options: { recordingEnabled: boolean }
): Promise<DailyRoom> {
  const roomName = videoRoomNameForSession(sessionId);
  try {
    return await createDailyRoom(sessionId, options);
  } catch (error) {
    if (error instanceof DailyApiError && error.statusCode === 409) {
      const existing = await getDailyRoom(roomName);
      if (existing !== null) {
        try {
          await patchDailyRoomProperties(roomName, {
            enable_recording: options.recordingEnabled ? "cloud" : "off",
          });
        } catch {
          // Best-effort reconciliation — the room is still usable
          // with its current setting. Drift detection in
          // `recordConsent` will fire on the next consent submission.
        }
        return existing;
      }
    }
    throw error;
  }
}

/**
 * Fetches an existing Daily room by name. Used by the rooms route to
 * recover from partial-failure states where a Daily room exists but
 * the Convex row was never written (e.g., a prior request crashed
 * after `createDailyRoom` returned but before `setVideoRoom` ran).
 * Returns null if the room does not exist on Daily's side.
 */
export async function getDailyRoom(
  roomName: string
): Promise<DailyRoom | null> {
  const encoded = encodeURIComponent(roomName);
  const response = await dailyFetch(`/rooms/${encoded}`, {
    method: "GET",
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return await parseDailyRoomResponse(response);
}

/**
 * Creates a short-lived Daily meeting token for the given room and user.
 * `isOwner: true` grants the instructor admin privileges (mute others,
 * manage recording, admit from waiting room); students get `false`.
 *
 * Tokens are NEVER persisted to the sessions table — owner-role JWTs
 * grant room-admin access and would let anyone with DB read access
 * seize every room. Tokens are generated fresh on each join.
 */
export async function createMeetingToken(
  input: CreateMeetingTokenInput
): Promise<{ token: string }> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const response = await dailyFetch("/meeting-tokens", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        room_name: input.roomName,
        user_id: input.userId,
        user_name: input.userName,
        is_owner: input.isOwner,
        exp: nowSeconds + input.ttlSeconds,
      },
    }),
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const data = (await response.json()) as { token?: string };
  if (typeof data.token !== "string") {
    throw new DailyApiError({
      statusCode: response.status,
      message: "Daily create-meeting-token response missing token",
    });
  }
  return { token: data.token };
}

/**
 * Requests a short-lived presigned download URL for a Daily.co
 * cloud recording. Used by the post-webhook transfer pipeline
 * (`src/trigger/recording-transfer.ts`) to pull the MP4 out of
 * Daily's storage and re-upload it to our Backblaze B2 bucket.
 *
 * Background: Daily's `recordings_bucket` mechanism requires AWS
 * IAM role assumption, which Backblaze B2 does not support. We
 * therefore leave Daily to store the recording in its default S3
 * and use this API to fetch it back into our own bucket on receipt
 * of the `recording.ready-to-download` webhook. See
 * `docs/plans/video-calling.md` for the full architecture.
 *
 * Daily's docs (https://docs.daily.co/reference/rest-api/recordings/access-link)
 * specify the response shape as `{ download_url, link_expires_at,
 * meeting_id, recording_id, session_id, ... }`. We only need the
 * URL — the expiry is short (~1h) which is fine for our
 * single-shot `PutObjectCommand` upload path; see the JSDoc on
 * `uploadFromUrl` in `packages/storage/src/uploads.ts` for why we
 * cap the download at the S3 single-PUT limit (5 GiB).
 *
 * 404 is surfaced as `null` so the transfer task can treat a
 * pre-purged recording (Daily's 7-day retention expired before
 * we processed the webhook) as a permanent failure rather than
 * retrying indefinitely.
 */
export async function getDailyRecordingAccessLink(
  recordingId: string
): Promise<string | null> {
  const response = await dailyFetch(
    `/recordings/${encodeURIComponent(recordingId)}/access-link`,
    { method: "GET" }
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw await parseErrorResponse(response);
  }
  const raw = (await response.json()) as DailyAccessLinkResponse;
  const parsed = dailyAccessLinkResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DailyApiError({
      statusCode: response.status,
      message: "Daily access-link response missing download_url",
    });
  }
  const link = parsed.data.download_url ?? parsed.data.url;
  if (typeof link !== "string" || link.length === 0) {
    throw new DailyApiError({
      statusCode: response.status,
      message: "Daily access-link response did not include a download URL",
    });
  }
  return link;
}

/**
 * Deletes a Daily.co cloud recording. Called by the transfer
 * pipeline AFTER a successful B2 upload so we don't accumulate
 * per-GB-month storage charges on Daily's side.
 *
 * Idempotent: Daily returns 404 when the recording was already
 * purged (auto-deletion at the 7-day retention boundary, or a
 * prior successful delete). We swallow 404 as success so a
 * re-run of the transfer task (e.g., from the manual retry
 * endpoint) is safe even if the original delete landed first.
 *
 * Any other non-2xx response is surfaced as a `DailyApiError` so
 * the caller can decide whether to retry — the transfer task
 * logs at warn level but does not abort the run, since the B2
 * copy is already persisted at that point and a stale Daily copy
 * is a billing concern, not a correctness one.
 */
export async function deleteDailyRecording(
  recordingId: string
): Promise<void> {
  const response = await dailyFetch(
    `/recordings/${encodeURIComponent(recordingId)}`,
    { method: "DELETE" }
  );
  if (response.status === 404) {
    return;
  }
  if (!response.ok) {
    throw await parseErrorResponse(response);
  }
}
