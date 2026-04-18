import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../../../convex/_generated/api";

export function useCurrentUser() {
  return useQuery({
    ...convexQuery(api.users.getCurrent, {}),
  });
}

export function useUserById(id: string) {
  return useQuery({
    ...convexQuery(api.users.getUserById, { id: id as any }),
    enabled: !!id,
  });
}

export function useUserByEmail(email: string) {
  return useQuery({
    ...convexQuery(api.users.getUserByEmail, { email }),
    enabled: !!email,
  });
}

export function useListUsers() {
  return useQuery({
    ...convexQuery(api.users.listUsers, {}),
  });
}
