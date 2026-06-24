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

export type RevokeClerkInvitationResult =
  | { success: true }
  | { success: false; reason: "not_found" | "already_consumed" | "not_revocable" | "transient_error"; message: string };

interface ClerkAPIError {
  status: number;
  message: string;
  code?: string;
}

function isClerkAPIError(error: unknown): error is ClerkAPIError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as Record<string, unknown>).status === "number"
  );
}

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

    if (isClerkAPIError(error)) {
      if (error.status === 409) {
        return {
          success: false,
          error: "User with this email already exists or has been invited",
        };
      }
      return {
        success: false,
        error: `Clerk API error (${error.status}): ${error.message}`,
      };
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: errorMessage,
    };
  }
}

export async function revokeClerkInvitation(
  invitationId: string
): Promise<RevokeClerkInvitationResult> {
  try {
    const client = await getClerkApi();
    await client.invitations.revokeInvitation(invitationId);
    return { success: true };
  } catch (error) {
    console.error("Failed to revoke Clerk invitation:", error);

    if (isClerkAPIError(error)) {
      if (error.status === 404) {
        return {
          success: false,
          reason: "not_found",
          message: "Invitation not found or already revoked",
        };
      }
      if (error.status === 409) {
        return {
          success: false,
          reason: "already_consumed",
          message: "Invitation was already accepted or consumed",
        };
      }
      if (error.status === 400) {
        return {
          success: false,
          reason: "not_revocable",
          message: "Invitation cannot be revoked (may already be expired or in unrevocable state)",
        };
      }
      return {
        success: false,
        reason: "transient_error",
        message: `Clerk API error (${error.status}): ${error.message}`,
      };
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      reason: "transient_error",
      message: errorMessage,
    };
  }
}
