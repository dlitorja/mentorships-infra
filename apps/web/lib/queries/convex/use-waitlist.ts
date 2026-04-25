import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

export function useAddToWaitlist() {
  const queryClient = useQueryClient();

  // @ts-ignore - Convex mutation typing issue with waitlist mutations
  return useMutation({
    mutationFn: useConvexMutation(api.waitlist.addToWaitlist),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
    },
  });
}

export function useRemoveFromWaitlist() {
  const queryClient = useQueryClient();

  // @ts-ignore - Convex mutation typing issue with waitlist mutations
  return useMutation({
    mutationFn: useConvexMutation(api.waitlist.removeFromWaitlist),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
    },
  });
}

export function useRemoveMultipleFromWaitlist() {
  const queryClient = useQueryClient();

  // @ts-ignore - Convex mutation typing issue with waitlist mutations
  return useMutation({
    mutationFn: useConvexMutation(api.waitlist.removeMultipleFromWaitlist),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
    },
  });
}

export function useRemoveByEmail() {
  const queryClient = useQueryClient();

  // @ts-ignore - Convex mutation typing issue with waitlist mutations
  return useMutation({
    mutationFn: useConvexMutation(api.waitlist.removeByEmail),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
    },
  });
}

export function useMarkNotified() {
  const queryClient = useQueryClient();

  // @ts-ignore - Convex mutation typing issue with waitlist mutations
  return useMutation({
    mutationFn: useConvexMutation(api.waitlist.markNotified),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
    },
  });
}

export function useMarkNotifiedByInstructor() {
  const queryClient = useQueryClient();

  // @ts-ignore - Convex mutation typing issue with waitlist mutations
  return useMutation({
    mutationFn: useConvexMutation(api.waitlist.markNotifiedByInstructor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
    },
  });
}

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