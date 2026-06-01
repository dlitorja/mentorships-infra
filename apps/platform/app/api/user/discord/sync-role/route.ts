import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { addGuildMemberRoleByName } from "@/lib/discord";

function getDiscordGuildId(): string | null {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId || guildId.trim().length === 0) return null;
  return guildId.trim();
}

function getDiscordStudentRoleName(): string | null {
  const roleName = process.env.DISCORD_STUDENT_ROLE_NAME;
  if (!roleName || roleName.trim().length === 0) return null;
  return roleName.trim();
}

function getDiscordProviderUserIdFromClerkExternalAccounts(
  externalAccounts: Array<{ provider?: unknown; providerUserId?: unknown }>
): string | null {
  for (const acct of externalAccounts) {
    if (!acct || typeof acct !== "object") continue;
    const provider = typeof acct.provider === "string" ? acct.provider.toLowerCase() : "";
    if (!provider.includes("discord")) continue;
    if (typeof acct.providerUserId === "string" && acct.providerUserId.length > 0) {
      return acct.providerUserId;
    }
  }
  return null;
}

export async function POST(): Promise<NextResponse> {
  try {
    const clerkAuth = await auth();
    const { userId } = clerkAuth;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const guildId = getDiscordGuildId();
    if (!guildId) {
      return NextResponse.json({ error: "Discord guild not configured" }, { status: 500 });
    }

    const studentRoleName = getDiscordStudentRoleName();
    if (!studentRoleName) {
      return NextResponse.json({ error: "Discord student role not configured" }, { status: 500 });
    }

    const clerk = await clerkClient();
    let clerkUser: Awaited<ReturnType<typeof clerk.users.getUser>> | null = null;
    try {
      clerkUser = await clerk.users.getUser(userId);
    } catch {
      return NextResponse.json({ error: "Failed to fetch Clerk user" }, { status: 500 });
    }

    if (!clerkUser) {
      return NextResponse.json({ error: "Failed to fetch Clerk user" }, { status: 500 });
    }

    const userRole = (clerkUser.publicMetadata?.role as string | undefined) ?? "student";
    if (userRole === "instructor" || userRole === "admin") {
      return NextResponse.json(
        { error: "Students only - instructors/admins cannot self-assign Discord roles" },
        { status: 403 }
      );
    }

    const discordUserId = getDiscordProviderUserIdFromClerkExternalAccounts(
      clerkUser.externalAccounts as Array<{ provider?: unknown; providerUserId?: unknown }>
    );

    if (!discordUserId) {
      return NextResponse.json(
        { error: "Discord account not connected", code: "DISCORD_NOT_CONNECTED" },
        { status: 409 }
      );
    }

    const convex = getConvexClient();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    await convex.mutation(api.userIdentities.upsertUserIdentity, {
      userId,
      provider: "discord",
      providerUserId: discordUserId,
    });

    let roleAssigned = false;
    let roleAssignError: string | null = null;
    try {
      await addGuildMemberRoleByName({
        guildId,
        discordUserId,
        roleName: studentRoleName,
      });
      roleAssigned = true;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      roleAssignError = error;
      console.error("[discord-sync-role] Failed to add guild member role:", error);
    }

    return NextResponse.json({
      success: true,
      discordConnected: true,
      discordUserId,
      roleAssigned,
      roleAssignError,
    });
  } catch (error) {
    console.error("[discord-sync-role] Error:", error);
    return NextResponse.json({ error: "Failed to sync Discord role" }, { status: 500 });
  }
}