import { inngest } from "../client";
import { reportInfo, reportError } from "@/lib/observability";
import { convexServerCall } from "@/lib/convex-server-call";

type ClerkUserCreatedEventData = {
  userId: string;
  email?: string;
  role?: string;
  firstName?: string;
  lastName?: string;
};

function shouldAutoCreateInstructor(): boolean {
  return process.env.CLERK_AUTO_CREATE_INSTRUCTOR === "true";
}

export const handleClerkUserCreated = inngest.createFunction(
  {
    id: "handle-clerk-user-created-instructor",
    name: "Handle Clerk User Created - Instructor Role",
    retries: 3,
  },
  { event: "clerk/user.created" },
  async ({ event, step }) => {
    const data = event.data as ClerkUserCreatedEventData;
    const { userId, email, role, firstName, lastName } = data;

    if (!userId || typeof userId !== "string") {
      return { processed: false, reason: "Invalid or missing userId" };
    }

    if (!email || typeof email !== "string") {
      await reportInfo({
        source: "inngest:clerk-user-instructor-lifecycle",
        message: "No email in event data, skipping",
        level: "warn",
        context: { userId },
      });
      return { processed: false, reason: "No email provided" };
    }

    if (role !== "instructor") {
      return { processed: true, action: "no-op", reason: "Not instructor role" };
    }

    const normalizedEmail = email.toLowerCase().trim();
    const name = [firstName, lastName].filter(Boolean).join(" ") || undefined;

    return await step.run("create-instructor-on-role-assignment", async () => {
      if (!shouldAutoCreateInstructor()) {
        await reportInfo({
          source: "inngest:clerk-user-instructor-lifecycle",
          message: "CLERK_AUTO_CREATE_INSTRUCTOR not enabled, skipping auto-creation",
          level: "info",
          context: { userId, email, role },
        });
        return { processed: true, action: "skipped", reason: "Feature flag disabled" };
      }

      try {
        const result = await convexServerCall<{
          success: boolean;
          instructorId?: string;
          reason?: string;
        }>("/instructors/create-for-clerk-user", {
          userId,
          email: normalizedEmail,
          name,
        });

        if (!result.success) {
          await reportError({
            source: "inngest:clerk-user-instructor-lifecycle",
            error: new Error(result.reason ?? "createInstructorForClerkUser failed"),
            level: "error",
            message: "Instructor auto-create returned unsuccessful result",
            context: { userId, email, reason: result.reason },
          });
          return {
            processed: false,
            action: "error",
            reason: result.reason ?? "Unknown failure",
          };
        }

        await reportInfo({
          source: "inngest:clerk-user-instructor-lifecycle",
          message: `Instructor auto-created via Clerk webhook`,
          level: "info",
          context: { userId, email, instructorId: result.instructorId },
        });

        return { processed: true, action: "created", instructorId: result.instructorId };
      } catch (error) {
        await reportError({
          source: "inngest:clerk-user-instructor-lifecycle",
          error: error instanceof Error ? error : new Error(String(error)),
          level: "error",
          message: "Failed to auto-create instructor",
          context: { userId, email },
        });
        return { processed: false, action: "error", reason: String(error) };
      }
    });
  }
);

type ClerkUserUpdatedEventData = {
  userId: string;
  email?: string;
  role?: string;
  firstName?: string;
  lastName?: string;
  previousRole?: string;
};

export const handleClerkUserUpdated = inngest.createFunction(
  {
    id: "handle-clerk-user-updated-instructor",
    name: "Handle Clerk User Updated - Instructor Role Changes",
    retries: 3,
  },
  { event: "clerk/user.updated" },
  async ({ event, step }) => {
    const data = event.data as ClerkUserUpdatedEventData;
    const { userId, email, role, firstName, lastName, previousRole } = data;

    if (!userId || typeof userId !== "string") {
      return { processed: false, reason: "Invalid or missing userId" };
    }

    if (!email || typeof email !== "string") {
      await reportInfo({
        source: "inngest:clerk-user-instructor-lifecycle",
        message: "No email in user.updated event, skipping",
        level: "warn",
        context: { userId },
      });
      return { processed: false, reason: "No email provided" };
    }

    const wasInstructor = previousRole === "instructor";
    const isNowInstructor = role === "instructor";

    if (!wasInstructor && !isNowInstructor) {
      return { processed: true, action: "no-op", reason: "No instructor role change" };
    }

    const normalizedEmail = email.toLowerCase().trim();
    const name = [firstName, lastName].filter(Boolean).join(" ") || undefined;

    if (!wasInstructor && isNowInstructor) {
      return await step.run("create-instructor-on-role-upgrade", async () => {
        if (!shouldAutoCreateInstructor()) {
          await reportInfo({
            source: "inngest:clerk-user-instructor-lifecycle",
            message: "CLERK_AUTO_CREATE_INSTRUCTOR not enabled, skipping auto-creation on upgrade",
            level: "info",
            context: { userId, email, role },
          });
          return { processed: true, action: "skipped", reason: "Feature flag disabled" };
        }

        try {
          const result = await convexServerCall<{
            success: boolean;
            instructorId?: string;
            reason?: string;
          }>("/instructors/create-for-clerk-user", {
            userId,
            email: normalizedEmail,
            name,
          });

          if (!result.success) {
            await reportError({
              source: "inngest:clerk-user-instructor-lifecycle",
              error: new Error(result.reason ?? "createInstructorForClerkUser failed"),
              level: "error",
              message: "Instructor auto-create returned unsuccessful result",
              context: { userId, email, reason: result.reason },
            });
            return {
              processed: false,
              action: "error",
              reason: result.reason ?? "Unknown failure",
            };
          }

          await reportInfo({
            source: "inngest:clerk-user-instructor-lifecycle",
            message: `Instructor auto-created via Clerk webhook role upgrade`,
            level: "info",
            context: { userId, email },
          });

          return { processed: true, action: "created", instructorId: result.instructorId };
        } catch (error) {
          await reportError({
            source: "inngest:clerk-user-instructor-lifecycle",
            error: error instanceof Error ? error : new Error(String(error)),
            level: "error",
            message: "Failed to auto-create instructor on role upgrade",
            context: { userId },
          });
          return { processed: false, action: "error", reason: String(error) };
        }
      });
    }

    if (wasInstructor && !isNowInstructor) {
      return await step.run("deactivate-instructor-on-role-removal", async () => {
        try {
          const result = await convexServerCall<{
            success: boolean;
            instructorId?: string;
            reason?: string;
          }>("/instructors/deactivate-by-user-id", { userId });

          if (!result.success) {
            await reportError({
              source: "inngest:clerk-user-instructor-lifecycle",
              error: new Error(result.reason ?? "deactivateInstructorByUserId failed"),
              level: "error",
              message: "Instructor deactivation returned unsuccessful result",
              context: { userId, reason: result.reason },
            });
            return {
              processed: false,
              action: "error",
              reason: result.reason ?? "Unknown failure",
            };
          }

          await reportInfo({
            source: "inngest:clerk-user-instructor-lifecycle",
            message: `Instructor deactivated via Clerk webhook role change`,
            level: "info",
            context: { userId, previousRole, newRole: role },
          });

          return { processed: true, action: "deactivated", instructorId: result.instructorId };
        } catch (error) {
          await reportError({
            source: "inngest:clerk-user-instructor-lifecycle",
            error: error instanceof Error ? error : new Error(String(error)),
            level: "error",
            message: "Failed to deactivate instructor",
            context: { userId },
          });
          return { processed: false, action: "error", reason: String(error) };
        }
      });
    }

    return { processed: true, action: "no-op", reason: "No relevant role change" };
  }
);
