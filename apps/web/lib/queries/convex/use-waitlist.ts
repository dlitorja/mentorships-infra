import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

export function useWaitlistForInstructor(args: { instructorSlug: string; mentorshipType?: "oneOnOne" | "group" }) {
  return useQuery({
    ...convexQuery(api.waitlist.getWaitlistForInstructor, args),
    enabled: !!args.instructorSlug,
  });
}

export function useWaitlistCounts(instructorSlug: string) {
  return useQuery({
    ...convexQuery(api.waitlist.getWaitlistCounts, { instructorSlug }),
    enabled: !!instructorSlug,
  });
}

export function useWaitlistStatus(args: { email: string; instructorSlug: string }) {
  return useQuery({
    ...convexQuery(api.waitlist.getWaitlistStatus, args),
    enabled: !!args.email && !!args.instructorSlug,
  });
}

export function useUnnotifiedWaitlist(args: { instructorSlug: string; mentorshipType?: "oneOnOne" | "group" }) {
  return useQuery({
    ...convexQuery(api.waitlist.getUnnotifiedWaitlist, args),
    enabled: !!args.instructorSlug,
  });
}

export function useAddToWaitlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      email: string;
      instructorSlug: string;
      mentorshipType: "oneOnOne" | "group";
    }) => {
      return await api.waitlist.addToWaitlist(args);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["waitlist", variables.instructorSlug] });
    },
  });
}

export function useRemoveFromWaitlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: Id<"marketingWaitlist"> }) => {
      return await api.waitlist.removeFromWaitlist(args);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
    },
  });
}

export function useRemoveMultipleFromWaitlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { ids: Id<"marketingWaitlist">[] }) => {
      return await api.waitlist.removeMultipleFromWaitlist(args);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
    },
  });
}

export function useRemoveByEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      email: string;
      instructorSlug: string;
      mentorshipType?: "oneOnOne" | "group";
    }) => {
      return await api.waitlist.removeByEmail(args);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["waitlist", variables.instructorSlug] });
    },
  });
}

export function useMarkNotified() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { ids: Id<"marketingWaitlist">[] }) => {
      return await api.waitlist.markNotified(args);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
    },
  });
}

export function useMarkNotifiedByInstructor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      instructorSlug: string;
      mentorshipType?: "oneOnOne" | "group";
    }) => {
      return await api.waitlist.markNotifiedByInstructor(args);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["waitlist", variables.instructorSlug] });
    },
  });
}