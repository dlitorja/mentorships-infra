import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../../../convex/_generated/api";

export function useUserSessionPacks(userId: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getUserSessionPacks, { userId }),
    enabled: !!userId,
  });
}

export function useUserActiveSessionPacks(userId: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getUserActiveSessionPacks, { userId }),
    enabled: !!userId,
  });
}

export function useMentorSessionPacks(mentorId: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getMentorSessionPacks, { mentorId: mentorId as any }),
    enabled: !!mentorId,
  });
}

export function useSessionPackById(id: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getSessionPackById, { id: id as any }),
    enabled: !!id,
  });
}

export function useSessionPackByPaymentId(paymentId: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getSessionPackByPaymentId, { paymentId: paymentId as any }),
    enabled: !!paymentId,
  });
}
