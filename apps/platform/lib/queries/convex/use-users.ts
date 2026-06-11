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

/**
 * Fetches the current authenticated user.
 * @returns {UseQueryResult<CurrentUser | null, Error>} Query result containing the current user
 */
export function useCurrentUser(): UseQueryResult<CurrentUser | null, Error> {
  return useQuery({
    ...convexQuery(api.users.getCurrentUser, {}),
  }) as UseQueryResult<CurrentUser | null, Error>;
}

/**
 * Fetches a user by their ID.
 * @param {Id<"users">} id - The user's ID
 * @returns {UseQueryResult} Query result containing the user
 */
export function useUserById(id: Id<"users">) {
  return useQuery({
    ...convexQuery(api.users.getUserById, { id }),
    enabled: !!id,
  });
}

/**
 * Fetches a user by their email address.
 * @param {string} email - The user's email
 * @returns {UseQueryResult} Query result containing the user
 */
export function useUserByEmail(email: string) {
  return useQuery({
    ...convexQuery(api.users.getUserByEmail, { email }),
    enabled: !!email,
  });
}

/**
 * Fetches all users.
 * @returns {UseQueryResult} Query result containing all users
 */
export function useListUsers() {
  return useQuery({
    ...convexQuery(api.users.listUsers, {}),
  });
}

/**
 * Mutation hook for updating a user.
 * Invalidates user queries on success.
 */
export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.users.updateUser),
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) => 
          query.queryKey[0] === "convex" && 
          typeof query.queryKey[1] === "string" && 
          query.queryKey[1].startsWith("users")
      });
    },
  });
}