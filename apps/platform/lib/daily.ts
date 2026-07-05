import type { Id } from "@/convex/_generated/dataModel";

const DEFAULT_DAILY_API_URL = "https://api.daily.co/v1";

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
 * (token-gated), configured for two participants, with screen-share and
 * cloud recording enabled. The room expires 24h after creation and
 * participants are auto-ejected at 4h (matching the recording cap).
 *
 * Idempotency is enforced at the caller level: this helper always
 * creates a new room. The route handler is responsible for checking
 * `sessions.videoRoomName` before calling.
 */
export async function createDailyRoom(
  sessionId: Id<"sessions">
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
        enable_recording: "cloud",
        enable_emoji_reactions: true,
        enable_hand_raising: true,
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

  const data = (await response.json()) as { name?: string; url?: string };
  if (typeof data.name !== "string" || typeof data.url !== "string") {
    throw new DailyApiError({
      statusCode: response.status,
      message: "Daily create-room response missing name or url",
    });
  }
  return { roomName: data.name, roomUrl: data.url };
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
