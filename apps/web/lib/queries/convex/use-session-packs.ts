import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

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

export function useInstructorSessionPacks(mentorId: Id<"instructors">) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getInstructorSessionPacks, { mentorId }),
    enabled: !!mentorId,
  });
}

export function useSessionPackById(id: Id<"sessionPacks">) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getSessionPackById, { id }),
    enabled: !!id,
  });
}

export function useSessionPackByPaymentId(paymentId: Id<"payments">) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getSessionPackByPaymentId, { paymentId }),
    enabled: !!paymentId,
  });
}
