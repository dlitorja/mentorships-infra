import { clerkClient } from "@clerk/nextjs/server";

const isDev = process.env.NODE_ENV === "development";
const isPreview = process.env.VERCEL_ENV === "preview" || process.env.CF_PAGES_BRANCH;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || (isDev || isPreview ? "https://dev.mentorships.huckleberry.art" : undefined);

if (!APP_URL) {
  throw new Error("NEXT_PUBLIC_APP_URL must be configured in production environments");
}

export interface CreateClerkInvitationOptions {
  emailAddress: string;
  instructorId?: string;
  redirectUrl?: string;
}

export interface ClerkInvitationResult {
  success: boolean;
  invitationId?: string;
  error?: string;
}

async function getClerkApi() {
  return await clerkClient();
}

export async function createClerkInvitation(
  options: CreateClerkInvitationOptions
): Promise<ClerkInvitationResult> {
  const { emailAddress, instructorId, redirectUrl = `${APP_URL}/dashboard` } = options;

  try {
    const client = await getClerkApi();

    const invitation = await client.invitations.createInvitation({
      emailAddress,
      redirectUrl,
      publicMetadata: instructorId
        ? { instructorId }
        : undefined,
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
