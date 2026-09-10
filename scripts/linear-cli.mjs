#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const MCP_URL = "https://mcp.linear.app/mcp";
const MCP_PROTOCOL_VERSION = "2025-06-18";
const AUTH_PATHS = [
  join(homedir(), ".local/share/opencode/mcp-auth.json"),
  join(homedir(), ".config/opencode/mcp-auth.json"),
];

async function readMcpAuth() {
  for (const path of AUTH_PATHS) {
    try {
      const raw = await readFile(path, "utf8");
      const auth = JSON.parse(raw);
      if (auth?.linear) return { entry: auth.linear, source: path };
    } catch {}
  }
  return null;
}

async function writeMcpAuth(path, entry) {
  const raw = await readFile(path, "utf8");
  const auth = JSON.parse(raw);
  auth.linear = entry;
  await writeFile(path, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

async function getToken() {
  const cached = await readMcpAuth();
  if (cached?.entry?.tokens?.accessToken) {
    return { token: cached.entry.tokens.accessToken, source: cached.source, cached };
  }
  if (process.env.LINEAR_API_KEY) {
    return { token: process.env.LINEAR_API_KEY, source: "LINEAR_API_KEY env var", cached: null };
  }
  return null;
}

async function tryRefresh(entry, source) {
  if (!entry?.tokens?.refreshToken || !entry?.clientInfo?.clientId) return null;
  const refreshUrl = new URL(MCP_URL);
  refreshUrl.pathname = "/oauth/token";
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: entry.tokens.refreshToken,
    client_id: entry.clientInfo.clientId,
  });
  const res = await fetch(refreshUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;
  const json = await res.json();
  if (!json.access_token) return null;
  const expiresIn = json.expires_in ?? 3600;
  const updated = {
    ...entry,
    tokens: {
      ...entry.tokens,
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? entry.tokens.refreshToken,
      expiresAt: Date.now() / 1000 + expiresIn,
      scope: json.scope ?? entry.tokens.scope,
    },
  };
  try {
    await writeMcpAuth(source, updated);
  } catch {}
  return json.access_token;
}

function parseResponse(text, contentType, requestId = null) {
  if (contentType?.includes("text/event-stream")) {
    const events = [];
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          events.push(JSON.parse(line.slice(6)));
        } catch {}
      }
    }
    if (requestId !== null) {
      const match = events.find((e) => e?.id === requestId);
      if (match) return match;
    }
    return events.find((e) => e?.id !== undefined) ?? events[0] ?? null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

class McpSession {
  constructor(token, cached) {
    this.token = token;
    this.sessionId = null;
    this.cached = cached;
  }

  async call(method, params = {}, id = 1) {
    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 401 && this.cached) {
        const cachedRef = this.cached;
        this.cached = null;
        const refreshed = await tryRefresh(cachedRef.entry, cachedRef.source);
        if (refreshed) {
          this.token = refreshed;
          return this.call(method, params, id);
        }
      }
      throw new Error(`MCP ${method} failed: HTTP ${res.status} ${body}`);
    }
    const newSession = res.headers.get("mcp-session-id");
    if (newSession) this.sessionId = newSession;
    const parsed = parseResponse(
      await res.text(),
      res.headers.get("content-type"),
      id
    );
    if (parsed?.error) {
      throw new Error(`MCP ${method} error: ${JSON.stringify(parsed.error)}`);
    }
    return parsed?.result;
  }

  async initialize() {
    await this.call(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "linear-cli", version: "1.0.0" },
      },
      0
    );
    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    await fetch(MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
  }

  async toolCall(name, args = {}) {
    return this.call("tools/call", { name, arguments: args }, 1);
  }
}

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args.flags[key] = next;
        i++;
      } else {
        args.flags[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function unwrap(result) {
  if (!result) return result;
  if (Array.isArray(result.content)) {
    for (const c of result.content) {
      if (c?.type === "text" && typeof c.text === "string") {
        try {
          return JSON.parse(c.text);
        } catch {
          return c.text;
        }
      }
    }
  }
  return result;
}

function formatResult(result) {
  return JSON.stringify(unwrap(result), null, 2);
}

function help() {
  return `Usage: linear <command> [args] [--flag value]

Commands:
  teams                              List all teams
  team <key>                         Get team by key (e.g. HUC)
  workspace                          Get workspace info
  users                              List users
  user <id-or-email>                 Get user by id or email
  projects [--team <key>]            List projects (optionally scoped to a team)
  project <id>                       Get project by id
  labels [--team <key>]              List issue labels
  issue <id>                         Get issue by id or identifier (e.g. HUC-12)
  issues [--team <key>] [--project <id>] [--limit <n>]
                                      List issues (filters: team, project, limit)
update-issue <id> [--state <name>] [--title <t>] [--description <d>] [--assignee <u>]
                  [--priority <0-4>] [--project <id>] [--team <key>]
                                      Update issue fields. At least one --flag is required.
  create-issue --team <key> --title <t> [--description <d>] [--project <id>] [--priority <0-4>]
                                      Create a new issue
  add-comment <id> --body <body>     Add a comment to an issue
  comments <id>                      List comments on an issue
  statuses [--team <key>]            List workflow states for a team

Auth:
  Reads the OAuth access token from opencode's MCP auth cache:
    ~/.local/share/opencode/mcp-auth.json (or ~/.config/opencode/...)
  Run \`opencode mcp auth linear\` once to populate it. The token refreshes
  automatically; no manual key rotation is needed.

Examples:
  linear teams
  linear issues --team HUC --limit 20
  linear issue HUC-12
  linear update-issue HUC-12 --state Done
linear update-issue HUC-10 --description "$(cat body.md)"
  linear add-comment HUC-12 --body "Fixed in PR #838."
`;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(help());
    return;
  }

  const auth = await getToken();
  if (!auth) {
    console.error(
      "No Linear auth token found.\n" +
        "Run `opencode mcp auth linear` once, or set LINEAR_API_KEY in your env.\n" +
        "Searched: " +
        AUTH_PATHS.join(", ")
    );
    process.exit(1);
  }
  const { token, source, cached } = auth;
  if (cached?.entry?.tokens?.expiresAt) {
    const expiresAt = cached.entry.tokens.expiresAt * 1000;
    if (Date.now() > expiresAt) {
      console.warn(`[warn] cached OAuth token expired at ${new Date(expiresAt).toISOString()}; will attempt refresh on first 401.`);
    }
  }

  const session = new McpSession(token, cached);
  await session.initialize();

  const args = parseArgs(argv);
  const [command, ...rest] = args._;

  let result;
  switch (command) {
    case "teams":
      result = await session.toolCall("list_teams", {});
      break;
    case "team": {
      const [key] = rest;
      if (!key) throw new Error("team <key> requires a team key (e.g. HUC)");
      result = await session.toolCall("get_team", { key });
      break;
    }
    case "workspace":
      result = await session.toolCall("get_workspace", {});
      break;
    case "users":
      result = await session.toolCall("list_users", {});
      break;
    case "user": {
      const [id] = rest;
      if (!id) throw new Error("user <id-or-email> requires an id or email");
      result = await session.toolCall("get_user", { id });
      break;
    }
    case "projects":
      result = await session.toolCall("list_projects", { team: args.flags.team });
      break;
    case "project": {
      const [id] = rest;
      if (!id) throw new Error("project <id> requires a project id");
      result = await session.toolCall("get_project", { id });
      break;
    }
    case "labels":
      result = await session.toolCall("list_issue_labels", { team: args.flags.team });
      break;
    case "issue": {
      const [id] = rest;
      if (!id) throw new Error("issue <id> requires an id or identifier");
      result = await session.toolCall("get_issue", { id });
      break;
    }
    case "issues":
      result = await session.toolCall("list_issues", {
        team: args.flags.team,
        project: args.flags.project,
        limit: args.flags.limit ? parseInt(args.flags.limit, 10) : undefined,
      });
      break;
    case "statuses":
      result = await session.toolCall("list_issue_statuses", { team: args.flags.team });
      break;
    case "update-issue": {
      const [id] = rest;
      if (!id) throw new Error("update-issue <id> requires an issue id");
      const fields = {};
      for (const k of ["title", "description", "state", "assignee", "priority", "project", "team"]) {
        if (args.flags[k] !== undefined) {
          fields[k] = k === "priority" ? parseInt(args.flags[k], 10) : args.flags[k];
        }
      }
      if (Object.keys(fields).length === 0) {
        throw new Error("update-issue requires at least one --flag (state, title, description, assignee, priority, project, team)");
      }
      result = await session.toolCall("save_issue", { id, ...fields });
      break;
    }
    case "create-issue": {
      if (!args.flags.team) throw new Error("--team is required");
      if (!args.flags.title) throw new Error("--title is required");
      result = await session.toolCall("save_issue", {
        team: args.flags.team,
        title: args.flags.title,
        description: args.flags.description,
        project: args.flags.project,
        priority: args.flags.priority ? parseInt(args.flags.priority, 10) : undefined,
      });
      break;
    }
    case "add-comment": {
      const [id] = rest;
      if (!id) throw new Error("add-comment <id> requires an issue id");
      if (!args.flags.body) throw new Error("--body is required");
      result = await session.toolCall("save_comment", { issueId: id, body: args.flags.body });
      break;
    }
    case "comments": {
      const [id] = rest;
      if (!id) throw new Error("comments <id> requires an issue id");
      result = await session.toolCall("list_comments", { issueId: id });
      break;
    }
    default:
      console.error(`Unknown command: ${command}\n\n${help()}`);
      process.exit(2);
  }

  console.log(formatResult(result));
  if (process.env.LINEAR_CLI_VERBOSE) {
    console.error(`\n[auth: ${source}]`);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  if (process.env.LINEAR_CLI_DEBUG) console.error(err.stack);
  process.exit(1);
});
