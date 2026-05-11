import "server-only";

export class DiscordApiError extends Error {
  public readonly status: number;
  public readonly code?: unknown;
  public readonly details?: unknown;

  constructor(args: { message: string; status: number; code?: unknown; details?: unknown }) {
    super(args.message);
    this.name = "DiscordApiError";
    this.status = args.status;
    this.code = args.code;
    this.details = args.details;
  }
}

function getDiscordBotToken(): string | null {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || token.trim().length === 0) return null;
  return token.trim();
}

function capDiscordMessageContent(content: string): string {
  // Discord message content limit is 2000 characters.
  if (content.length <= 2000) return content;
  return `${content.slice(0, 1997)}...`;
}

async function discordRequest<T>(args: {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
}): Promise<T> {
  const token = getDiscordBotToken();
  if (!token) {
    throw new DiscordApiError({
      status: 0,
      message: "DISCORD_BOT_TOKEN is not configured",
    });
  }

  const url = `https://discord.com/api/v10${args.path.startsWith("/") ? args.path : `/${args.path}`}`;
  const res = await fetch(url, {
    method: args.method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
  });

  const text = await res.text();
  const json = text.length > 0 ? safeJsonParse(text) : null;

  if (!res.ok) {
    const message =
      typeof json === "object" && json && "message" in json && typeof (json as { message?: unknown }).message === "string"
        ? (json as { message: string }).message
        : `Discord API request failed: ${res.status}`;

    const code =
      typeof json === "object" && json && "code" in json ? (json as { code?: unknown }).code : undefined;

    throw new DiscordApiError({
      status: res.status,
      message,
      code,
      details: json ?? text.slice(0, 2000),
    });
  }

  return (json as T) ?? (null as T);
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

type DiscordDmChannel = { id: string };

export async function createDmChannel(discordUserId: string): Promise<DiscordDmChannel> {
  return await discordRequest<DiscordDmChannel>({
    method: "POST",
    path: "/users/@me/channels",
    body: { recipient_id: discordUserId },
  });
}

export async function sendDm(args: { discordUserId: string; content: string }): Promise<{ messageId: string }> {
  const channel = await createDmChannel(args.discordUserId);
  const res = await discordRequest<{ id: string }>({
    method: "POST",
    path: `/channels/${channel.id}/messages`,
    body: { content: capDiscordMessageContent(args.content) },
  });
  return { messageId: res.id };
}

export async function getGuildRoles(guildId: string): Promise<Array<{ id: string; name: string }>> {
  return await discordRequest<Array<{ id: string; name: string }>>({
    method: "GET",
    path: `/guilds/${guildId}/roles`,
  });
}

export async function addGuildMemberRole(args: {
  guildId: string;
  discordUserId: string;
  roleId: string;
}): Promise<void> {
  await discordRequest<unknown>({
    method: "PUT",
    path: `/guilds/${args.guildId}/members/${args.discordUserId}/roles/${args.roleId}`,
  });
}

export async function addGuildMemberRoleByName(args: {
  guildId: string;
  discordUserId: string;
  roleName: string;
}): Promise<{ roleId: string }> {
  const roles = await getGuildRoles(args.guildId);
  const role = roles.find((r) => r.name.toLowerCase() === args.roleName.toLowerCase());
  if (!role) {
    throw new DiscordApiError({
      status: 404,
      message: `Role not found in guild: ${args.roleName}`,
      details: { roleName: args.roleName, rolesCount: roles.length },
    });
  }
  await addGuildMemberRole({ guildId: args.guildId, discordUserId: args.discordUserId, roleId: role.id });
  return { roleId: role.id };
}


