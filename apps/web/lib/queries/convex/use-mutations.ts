import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "../../../../../convex/_generated/api";

/**
 * Mutation hook for creating a new product.
 * Invalidates product queries on success to refresh the product list.
 */
export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.products.createProduct),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

/**
 * Mutation hook for updating an existing product.
 * Invalidates product queries on success to refresh the product list.
 */
export function useUpdateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.products.updateProduct),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

/**
 * Mutation hook for deleting a product.
 * Invalidates product queries on success to refresh the product list.
 */
export function useDeleteProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.products.deleteProduct),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

/**
 * Mutation hook for activating a product.
 * Invalidates product queries on success to refresh the product list.
 */
export function useActivateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.products.activateProduct),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

/**
 * Mutation hook for deactivating a product.
 * Invalidates product queries on success to refresh the product list.
 */
export function useDeactivateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.products.deactivateProduct),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

/**
 * Mutation hook for creating a new session.
 * Invalidates session queries on success to refresh the session list.
 */
export function useCreateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessions.createSession),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

/**
 * Mutation hook for updating a session's details.
 * Invalidates session queries on success to refresh the session list.
 */
export function useUpdateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessions.updateSession),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

/**
 * Mutation hook for completing a session.
 * Invalidates session and session pack queries on success.
 */
export function useCompleteSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessions.completeSession),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["sessionPacks"] });
    },
  });
}

/**
 * Mutation hook for cancelling a session.
 * Invalidates session queries on success to refresh the session list.
 */
export function useCancelSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessions.cancelSession),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

/**
 * Mutation hook for creating a new session pack.
 * Invalidates session pack queries on success to refresh the session pack list.
 */
export function useCreateSessionPack() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessionPacks.createSessionPack),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessionPacks"] });
    },
  });
}

/**
 * Mutation hook for updating a session pack.
 * Invalidates session pack queries on success to refresh the session pack list.
 */
export function useUpdateSessionPack() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessionPacks.updateSessionPack),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessionPacks"] });
    },
  });
}

/**
 * Mutation hook for using a session from a session pack.
 * Invalidates session pack queries on success to refresh availability.
 */
export function useUseSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessionPacks.useSession),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessionPacks"] });
    },
  });
}

/**
 * Mutation hook for updating user information.
 * Invalidates user queries on success to refresh user data.
 */
export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.users.updateUser),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

/**
 * Mutation hook for creating a testimonial.
 * Invalidates testimonial queries on success to refresh the testimonial list.
 */
export function useCreateTestimonial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.createTestimonial),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["testimonials"] });
    },
  });
}

/**
 * Mutation hook for creating a student result.
 * Invalidates student result queries on success to refresh the result list.
 */
export function useCreateStudentResult() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.createStudentResult),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studentResults"] });
    },
  });
}