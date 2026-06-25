import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

/**
 * Fetches all session packs for a specific user.
 * @param {string} userId - The user's ID
 * @returns {UseQueryResult} Query result containing the user's session packs
 */
export function useUserSessionPacks(userId: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getUserSessionPacks, { userId }),
    enabled: !!userId,
  });
}

/**
 * Fetches active session packs for a specific user.
 * @param {string} userId - The user's ID
 * @returns {UseQueryResult} Query result containing the user's active session packs
 */
export function useUserActiveSessionPacks(userId: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getUserActiveSessionPacks, { userId }),
    enabled: !!userId,
  });
}

/**
 * Fetches all session packs for a specific instructor.
 * @param {Id<"instructors">} instructorId - The instructor's ID
 * @returns {UseQueryResult} Query result containing the instructor's session packs
 */
export function useInstructorSessionPacks(instructorId: Id<"instructors">) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getInstructorSessionPacks, { instructorId }),
    enabled: !!instructorId,
  });
}

/**
 * Fetches a single session pack by ID.
 * @param {Id<"sessionPacks">} id - The session pack ID
 * @returns {UseQueryResult} Query result containing the session pack
 */
export function useSessionPackById(id: Id<"sessionPacks">) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getSessionPackById, { id }),
    enabled: !!id,
  });
}

/**
 * Fetches a session pack by payment ID.
 * @param {Id<"payments">} paymentId - The payment ID
 * @returns {UseQueryResult} Query result containing the session pack
 */
export function useSessionPackByPaymentId(paymentId: Id<"payments">) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getSessionPackByPaymentId, { paymentId }),
    enabled: !!paymentId,
  });
}