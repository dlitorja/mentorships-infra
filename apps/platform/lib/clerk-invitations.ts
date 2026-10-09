import { clerkClient } from "@clerk/nextjs/server";

const isDev = process.env.NODE_ENV === "development";
const isPreview = process.env.VERCEL_ENV === "preview" || process.env.CF_PAGES_BRANCH;
const isCloudflare = process.env.CF_PAGES !== undefined;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || (isDev || isPreview || isCloudflare ? "https://dev.mentorships.huckleberry.art" : undefined);

if (!APP_URL) {
  throw new Error("NEXT_PUBLIC_APP_URL must be configured in production environments");
}

export interface CreateClerkInvitationOptions {
  emailAddress: string;
  instructorId?: string;
  redirectUrl?: string;
}

export interface CreateStudentClerkInvitationOptions {
  emailAddress: string;
  studentId?: string;
  redirectUrl?: string;
  /**
   * PR 12 PR 3: `onboardingId` is the `adminOnboardings` row the
   * student is being invited into. Set on Clerk's `publicMetadata`
   * so the post-signup redirect (apps/platform/app/sign-up-redirect)
   * can route the student straight to `/onboarding/[onboardingId]`
   * instead of `/dashboard`. Optional to keep the legacy
   * `/api/admin/students/invite` flow working unchanged.
   */
  onboardingId?: string;
}

export interface ClerkInvitationResult {
  success: boolean;
  invitationId?: string;
  error?: string;
}

async function getClerkApi() {
  return await clerkClient();
}

/**
 * PR 12 PR 3: Build the `publicMetadata` payload Clerk stores on the
 * invitation. We always set `isStudent: true` + `role: "student"` so
 * the post-signup routing can read it via `useUser().publicMetadata`
 * without an extra Clerk API call. `studentId` (legacy) and
 * `onboardingId` (new) are included when present; Clerk treats
 * undefined as "not set", which is what we want.
 */
function buildStudentPublicMetadata(args: {
  studentId: string | undefined;
  onboardingId: string | undefined;
}): Record<string, string | boolean> {
  const metadata: Record<string, string | boolean> = {
    isStudent: true,
    role: "student",
  };
  if (args.studentId) metadata.studentId = args.studentId;
  if (args.onboardingId) metadata.onboardingId = args.onboardingId;
  return metadata;
}

export async function createClerkInvitation(
  options: CreateClerkInvitationOptions
): Promise<ClerkInvitationResult> {
  // Route invites to the in-app SignUp page so Clerk processes the invitation ticket
  const { emailAddress, instructorId, redirectUrl = `${APP_URL}/sign-up` } = options;

  try {
    const client = await getClerkApi();

    const invitation = await client.invitations.createInvitation({
      emailAddress,
      redirectUrl,
      publicMetadata: instructorId
        ? { instructorId, isInstructor: true, role: "instructor" }
        : { isInstructor: true, role: "instructor" },
    });

    return {
      success: true,
      invitationId: invitation.id,
    };
  } catch (error) {
    console.error("Failed to create Clerk invitation:", error);

    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (errorMessage.includes("already exists") || errorMessage.includes("already been invited")) {
      return {
        success: false,
        error: "User with this email already exists or has been invited",
      };
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

export async function createStudentClerkInvitation(
  options: CreateStudentClerkInvitationOptions
): Promise<ClerkInvitationResult> {
  const { emailAddress, studentId, redirectUrl = `${APP_URL}/sign-up`, onboardingId } = options;

  try {
    const client = await getClerkApi();

    const invitation = await client.invitations.createInvitation({
      emailAddress,
      redirectUrl,
      publicMetadata: buildStudentPublicMetadata({ studentId, onboardingId }),
    });

    return {
      success: true,
      invitationId: invitation.id,
    };
  } catch (error) {
    console.error("Failed to create student Clerk invitation:", error);

    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (errorMessage.includes("already exists") || errorMessage.includes("already been invited")) {
      return {
        success: false,
        error: "User with this email already exists or has been invited",
      };
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

export async function getClerkUserByEmail(email: string): Promise<string | null> {
  try {
    const client = await getClerkApi();
    const response = await client.users.getUserList({
      emailAddress: [email],
      limit: 1,
    });

    const users = response.data;
    if (users.length > 0) {
      return users[0].id;
    }
    return null;
  } catch (error) {
    console.error("Failed to get Clerk user by email:", error);
    return null;
  }
}

export async function searchClerkUsers(query: string): Promise<
  Array<{
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  }>
> {
  try {
    const client = await getClerkApi();
    const response = await client.users.getUserList({
      query,
      limit: 10,
    });

    return response.data.map((user) => ({
      id: user.id,
      email: user.emailAddresses[0]?.emailAddress || "",
      firstName: user.firstName || undefined,
      lastName: user.lastName || undefined,
    }));
  } catch (error) {
    console.error("Failed to search Clerk users:", error);
    return [];
  }
}
