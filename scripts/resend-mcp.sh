#!/usr/bin/env bash
# Launcher for the Resend MCP server.
#
# Reads credentials from the app env file at spawn time so the Resend key lives
# in exactly one place (apps/platform/.env.local) instead of being duplicated
# into OpenCode's service environment. Override the file with
# OPENCODE_RESEND_ENV_FILE when needed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${OPENCODE_RESEND_ENV_FILE:-$ROOT/apps/platform/.env.local}"

read_key() {
  grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null \
    | cut -d= -f2- \
    | sed -E "s/^[\"']//; s/[\"']$//"
}

if [ ! -f "$ENV_FILE" ]; then
  echo "resend-mcp: env file not found: $ENV_FILE" >&2
  exit 1
fi

RESEND_API_KEY="$(read_key RESEND_API_KEY)"
SENDER_EMAIL_ADDRESS="$(read_key EMAIL_FROM)"

if [ -z "$RESEND_API_KEY" ]; then
  echo "resend-mcp: RESEND_API_KEY missing in $ENV_FILE" >&2
  exit 1
fi

export RESEND_API_KEY SENDER_EMAIL_ADDRESS

exec node "$ROOT/node_modules/resend-mcp/dist/index.js"
