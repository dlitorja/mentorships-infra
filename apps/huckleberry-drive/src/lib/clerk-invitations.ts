import { clerkClient } from "@clerk/nextjs/server";

const APP_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://drive.huckleberry.art";

export interface CreateHdClerkInvitationOptions {
  emailAddress: string;
  role: "student" | "instructor" | "admin" | "video_editor";
  redirectUrl?: string;
}

export type ClerkInvitationResult =
  | { success: true; invitationId: string }
  | { success: false; error: string };

async function getClerkApi() {
  return await clerkClient();
}

export async function createHdClerkInvitation(
  options: CreateHdClerkInvitationOptions
): Promise<ClerkInvitationResult> {
  const { emailAddress, role, redirectUrl = `${APP_URL}/sign-up` } = options;

  try {
    const client = await getClerkApi();

    const invitation = await client.invitations.createInvitation({
      emailAddress,
      redirectUrl,
      publicMetadata: { role },
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

export async function revokeClerkInvitation(invitationId: string): Promise<boolean> {
  try {
    const client = await getClerkApi();
    await client.invitations.revokeInvitation(invitationId);
    return true;
  } catch (error) {
    console.error("Failed to revoke Clerk invitation:", error);
    return false;
  }
}
