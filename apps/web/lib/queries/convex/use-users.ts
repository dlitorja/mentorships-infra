import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

export function useCurrentUser() {
  return useQuery({
    ...convexQuery(api.users.getCurrentUser, {}),
  });
}

export function useUserById(id: Id<"users">) {
  return useQuery({
    ...convexQuery(api.users.getUserById, { id }),
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
