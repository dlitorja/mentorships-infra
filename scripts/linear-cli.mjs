#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const MCP_URL = "https://mcp.linear.app/mcp";
const MCP_PROTOCOL_VERSION = "2025-06-18";
const AUTH_PATHS = [
  join(homedir(), ".local/share/opencode/mcp-auth.json"),
  join(homedir(), ".config/opencode/mcp-auth.json"),
];

async function readMcpAuthToken() {
  for (const path of AUTH_PATHS) {
    try {
      const raw = await readFile(path, "utf8");
      const auth = JSON.parse(raw);
      const tokens = auth?.linear?.tokens;
      if (tokens?.accessToken) return { token: tokens.accessToken, source: path };
    } catch {}
  }
  return null;
}

function parseSseResponse(text) {
  const events = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) {
      try {
        events.push(JSON.parse(line.slice(6)));
      } catch {}
    }
  }
  return events[0] ?? null;
}

async function mcpCall(token, method, params = {}, id = 1) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  });
  if (!res.ok) {
    throw new Error(`MCP ${method} failed: HTTP ${res.status} ${await res.text()}`);
  }
  const text = await res.text();
  const parsed = parseSseResponse(text);
  if (parsed?.error) {
    throw new Error(`MCP ${method} error: ${JSON.stringify(parsed.error)}`);
  }
  return parsed?.result;
}

async function mcpInitialize(token) {
  return mcpCall(
    token,
    "initialize",
    {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "linear-cli", version: "1.0.0" },
    },
    0
  );
}

async function mcpToolCall(token, name, args = {}) {
  return mcpCall(token, "tools/call", { name, arguments: args }, 1);
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
  update-issue <id> --state <name>
                                      Update issue state (Backlog, Todo, In Progress, Done, Canceled)
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
  linear add-comment HUC-12 --body "Fixed in PR #838."
`;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(help());
    return;
  }

  const auth = await readMcpAuthToken();
  const envToken = process.env.LINEAR_API_KEY;
  let token;
  let tokenSource;
  if (auth) {
    token = auth.token;
    tokenSource = `mcp-auth.json (${auth.source})`;
  } else if (envToken) {
    token = envToken;
    tokenSource = "LINEAR_API_KEY env var";
  } else {
    console.error(
      "No Linear auth token found.\n" +
        "Run `opencode mcp auth linear` once, or set LINEAR_API_KEY in your env.\n" +
        "Searched: " +
        AUTH_PATHS.join(", ")
    );
    process.exit(1);
  }

  await mcpInitialize(token);

  const args = parseArgs(argv);
  const [command, ...rest] = args._;

  let result;
  switch (command) {
    case "teams":
      result = await mcpToolCall(token, "list_teams", {});
      break;
    case "team": {
      const [key] = rest;
      if (!key) throw new Error("team <key> requires a team key (e.g. HUC)");
      result = await mcpToolCall(token, "get_team", { key });
      break;
    }
    case "workspace":
      result = await mcpToolCall(token, "get_workspace", {});
      break;
    case "users":
      result = await mcpToolCall(token, "list_users", {});
      break;
    case "user": {
      const [id] = rest;
      if (!id) throw new Error("user <id-or-email> requires an id or email");
      result = await mcpToolCall(token, "get_user", { id });
      break;
    }
    case "projects":
      result = await mcpToolCall(token, "list_projects", {
        team: args.flags.team,
      });
      break;
    case "project": {
      const [id] = rest;
      if (!id) throw new Error("project <id> requires a project id");
      result = await mcpToolCall(token, "get_project", { id });
      break;
    }
    case "labels":
      result = await mcpToolCall(token, "list_issue_labels", {
        team: args.flags.team,
      });
      break;
    case "issue": {
      const [id] = rest;
      if (!id) throw new Error("issue <id> requires an id or identifier");
      result = await mcpToolCall(token, "get_issue", { id });
      break;
    }
    case "issues":
      result = await mcpToolCall(token, "list_issues", {
        team: args.flags.team,
        project: args.flags.project,
        limit: args.flags.limit ? parseInt(args.flags.limit, 10) : undefined,
      });
      break;
    case "statuses":
      result = await mcpToolCall(token, "list_issue_statuses", {
        team: args.flags.team,
      });
      break;
    case "update-issue": {
      const [id] = rest;
      if (!id) throw new Error("update-issue <id> requires an issue id");
      if (!args.flags.state) throw new Error("--state is required");
      result = await mcpToolCall(token, "save_issue", {
        id,
        state: args.flags.state,
      });
      break;
    }
    case "create-issue": {
      if (!args.flags.team) throw new Error("--team is required");
      if (!args.flags.title) throw new Error("--title is required");
      result = await mcpToolCall(token, "save_issue", {
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
      result = await mcpToolCall(token, "save_comment", {
        issueId: id,
        body: args.flags.body,
      });
      break;
    }
    case "comments": {
      const [id] = rest;
      if (!id) throw new Error("comments <id> requires an issue id");
      result = await mcpToolCall(token, "list_comments", { issueId: id });
      break;
    }
    default:
      console.error(`Unknown command: ${command}\n\n${help()}`);
      process.exit(2);
  }

  console.log(formatResult(result));
  if (process.env.LINEAR_CLI_VERBOSE) {
    console.error(`\n[auth: ${tokenSource}]`);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  if (process.env.LINEAR_CLI_DEBUG) console.error(err.stack);
  process.exit(1);
});
