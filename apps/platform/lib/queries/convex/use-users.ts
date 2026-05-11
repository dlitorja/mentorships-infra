import { useQuery, useMutation, useQueryClient, UseQueryResult } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export type CurrentUser = {
  _id: Id<"users">;
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: "student" | "instructor" | "admin" | "video_editor";
  timeZone?: string;
  clerkId: string;
};

export function useCurrentUser(): UseQueryResult<CurrentUser | null, Error> {
  return useQuery({
    ...convexQuery(api.users.getCurrentUser, {}),
  }) as UseQueryResult<CurrentUser | null, Error>;
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

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.users.updateUser),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}