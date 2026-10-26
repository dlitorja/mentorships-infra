import { convexServerCall } from "@/lib/convex-server-call";

/**
 * Shape returned by the `CONVEX_HTTP_KEY`-gated
 * `/instructors/google-credentials` Convex endpoint.
 *
 * Public instructor queries deliberately omit `googleRefreshToken`, so
 * server routes that talk to Google Calendar fetch it here instead.
 */
export type InstructorGoogleCredentials = {
  googleRefreshToken: string | null;
  googleCalendarId: string | null;
  googleAvailabilityCalendarIds: string[];
};

/**
 * Fetches an instructor's Google OAuth credential server-to-server.
 * Returns `null` when the instructor no longer exists.
 *
 * Throws `ConvexServerCallError` when `CONVEX_HTTP_KEY` / `CONVEX_URL`
 * are not configured or Convex rejects the request.
 */
export async function fetchInstructorGoogleCredentials(
  instructorId: string,
): Promise<InstructorGoogleCredentials | null> {
  return await convexServerCall<InstructorGoogleCredentials | null>(
    "/instructors/google-credentials",
    { instructorId },
  );
}
