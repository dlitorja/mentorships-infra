import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

/**
 * Mutation hook for adding a user to a waitlist.
 * Invalidates waitlist queries on success.
 */
export function useAddToWaitlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.waitlist.addToWaitlist),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
    },
  });
}

/**
 * Mutation hook for removing a user from a waitlist.
 * Invalidates waitlist queries on success.
 */
export function useRemoveFromWaitlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.waitlist.removeFromWaitlist),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
    },
  });
}

/**
 * Mutation hook for removing multiple users from a waitlist.
 * Invalidates waitlist queries on success.
 */
export function useRemoveMultipleFromWaitlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.waitlist.removeMultipleFromWaitlist),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
    },
  });
}

/**
 * Mutation hook for removing a user from waitlist by email.
 * Invalidates waitlist queries on success.
 */
export function useRemoveByEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.waitlist.removeByEmail),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
    },
  });
}

/**
 * Mutation hook for marking a waitlist entry as notified.
 * Invalidates waitlist queries on success.
 */
export function useMarkNotified() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.waitlist.markNotified),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
    },
  });
}

/**
 * Mutation hook for marking waitlist entries as notified for a specific instructor.
 * Invalidates waitlist queries on success.
 */
export function useMarkNotifiedByInstructor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.waitlist.markNotifiedByInstructor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
    },
  });
}

/**
 * Fetches waitlist entries for a specific instructor.
 * @param {string} instructorSlug - The instructor's slug
 * @param {"oneOnOne" | "group" | undefined} mentorshipType - Optional mentorship type filter
 * @returns {UseQueryResult} Query result containing waitlist entries
 */
export function useWaitlistForInstructor(
  instructorSlug: string,
  mentorshipType?: "oneOnOne" | "group"
) {
  return useQuery({
    ...convexQuery(api.waitlist.getWaitlistForInstructor, {
      instructorSlug,
      mentorshipType,
    }),
    enabled: !!instructorSlug,
  });
}