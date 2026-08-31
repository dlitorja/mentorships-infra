"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";

const DEFAULT_DAILY_API_URL = "https://api.daily.co/v1";

type DailyRoom = {
  name: string;
  url: string;
};

async function dailyFetch(path: string, options: RequestInit): Promise<Response> {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) {
    throw new Error("DAILY_API_KEY is not configured");
  }
  const baseUrl = process.env.DAILY_API_URL ?? DEFAULT_DAILY_API_URL;
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

function parseDailyRoomResponse(response: Response): Promise<DailyRoom> {
  return response.json().then((data: unknown) => {
    const parsed = data as { name?: string; url?: string };
    if (typeof parsed.name !== "string" || typeof parsed.url !== "string") {
      throw new Error("Daily room response missing name or url");
    }
    return { name: parsed.name, url: parsed.url };
  });
}

async function getDailyRoom(roomName: string): Promise<DailyRoom | null> {
  const encoded = encodeURIComponent(roomName);
  const response = await dailyFetch(`/rooms/${encoded}`, { method: "GET" });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Daily.co GET /rooms/${encoded} failed: ${response.status} ${text}`);
  }

  return parseDailyRoomResponse(response);
}

/**
 * Trusted action that verifies a Daily room exists and then persists
 * the room metadata on an ad-hoc session. Used by
 * `POST /api/video/start-adhoc` so students can start ad-hoc calls
 * without being given a public mutation that accepts arbitrary room
 * metadata.
 *
 * The action performs the auth checks that `setVideoRoom` used to do
 * for ad-hoc sessions, plus an explicit Daily GET to confirm the
 * caller is not lying about the room name/url. Once verified, the
 * actual write goes through the internal `setVideoRoomInternal`
 * mutation.
 */
export const setVerifiedAdhocVideoRoom = action({
  args: {
    sessionId: v.id("sessions"),
    videoRoomName: v.string(),
    videoRoomUrl: v.string(),
    roomRecordingEnabled: v.boolean(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ roomName: string; roomUrl: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "VIDEO_UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    const session = await ctx.runQuery(internal.sessions.getSessionByIdInternal, {
      sessionId: args.sessionId,
    });
    if (!session) {
      throw new ConvexError({
        code: "VIDEO_SESSION_NOT_FOUND",
        message: "Session not found",
      });
    }
    if (session.callEndedAt !== undefined) {
      throw new ConvexError({
        code: "VIDEO_FORBIDDEN_CALL_ENDED",
        message: "Call has already ended",
      });
    }
    if (!session.isAdhoc) {
      throw new ConvexError({
        code: "VIDEO_FORBIDDEN_NOT_ADHOC",
        message: "Session is not an ad-hoc call",
      });
    }
    if (session.videoRoomName !== undefined) {
      throw new ConvexError({
        code: "VIDEO_ROOM_NAME_CONFLICT",
        message: "Session already has a video room",
      });
    }

    const instructor = await ctx.runQuery(
      internal.instructors.getInstructorByIdInternal,
      { instructorId: session.instructorId }
    );
    const isInstructor =
      instructor !== null && instructor.userId === identity.subject;
    const isStudent = identity.subject === session.studentId;
    if (!isInstructor && !isStudent) {
      throw new ConvexError({
        code: "VIDEO_FORBIDDEN_NOT_PARTICIPANT",
        message:
          "Forbidden: only the session's instructor or student can set the video room",
      });
    }

    // Verify the room exists on Daily before trusting the metadata.
    const room = await getDailyRoom(args.videoRoomName);
    if (room === null) {
      throw new ConvexError({
        code: "VIDEO_ROOM_NOT_FOUND",
        message: "Daily room does not exist",
      });
    }
    if (room.url !== args.videoRoomUrl) {
      throw new ConvexError({
        code: "VIDEO_ROOM_URL_MISMATCH",
        message: "Daily room URL does not match the provided URL",
      });
    }

    await ctx.runMutation(internal.sessions.setVideoRoomInternal, {
      sessionId: args.sessionId,
      videoRoomName: args.videoRoomName,
      videoRoomUrl: args.videoRoomUrl,
      roomRecordingEnabled: args.roomRecordingEnabled,
    });

    return { roomName: args.videoRoomName, roomUrl: args.videoRoomUrl };
  },
});
