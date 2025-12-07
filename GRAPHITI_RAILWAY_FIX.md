# Fix Graphiti MCP Server on Railway - HTTP Transport Configuration

## Problem
The Graphiti MCP server is currently configured to use SSE (Server-Sent Events) transport, which requires clients to send `Accept: application/json, text/event-stream` headers. Cursor only sends `Accept: application/json`, causing 406 errors.

## Solution
Configure the server to use HTTP transport instead of SSE, which only requires `application/json`.

## Steps to Fix on Railway

### Option 1: Modify Start Command (Recommended)

1. **Go to Railway Dashboard**
   - Navigate to: https://railway.app
   - Select your project: `knowledge-graph-mcp-production` (or similar)

2. **Open the Graphiti MCP Service**
   - Click on the service that's running the Graphiti MCP server

3. **Go to Settings Tab**
   - Click on the "Settings" tab in the service

4. **Find the Start Command**
   - Look for "Start Command" or "Command" field
   - Current command likely looks like:
     ```
     uv run graphiti_mcp_server.py --transport sse
     ```
   - Or it might be in a `railway.json` or `Procfile`

5. **Fix the File Path**
   - The script is likely in a subdirectory. Try one of these:
     ```
     uv run mcp_server/graphiti_mcp_server.py
     ```
     Or:
     ```
     uv run --directory mcp_server graphiti_mcp_server.py
     ```
     Or if it's in the root:
     ```
     uv run python mcp_server/graphiti_mcp_server.py
     ```
   - **To find the correct path**, check your repository structure or Railway build logs to see where the file is located

6. **Save and Redeploy**
   - Save the changes
   - Railway will automatically redeploy the service

### Option 2: Use Environment Variable

If the start command uses an environment variable:

1. **Go to Service Settings → Variables**
   - Add or modify: `MCP_TRANSPORT=http`
   - Or: `TRANSPORT=http`

2. **Redeploy the service**

### Option 3: Check Dockerfile or railway.json

If the service uses a Dockerfile or `railway.json`:

1. **Check the repository** (if you have access)
   - Look for `Dockerfile`, `railway.json`, or `Procfile`
   - Modify the command to use `--transport http` or remove SSE transport

2. **Example Dockerfile CMD:**
   ```dockerfile
   CMD ["uv", "run", "graphiti_mcp_server.py", "--transport", "http"]
   ```

3. **Example railway.json:**
   ```json
   {
     "build": {
       "builder": "NIXPACKS"
     },
     "deploy": {
       "startCommand": "uv run graphiti_mcp_server.py --transport http"
     }
   }
   ```

## Verify the Fix

After redeploying, test the endpoint:

```bash
# Should work with only application/json
curl -X POST https://knowledge-graph-mcp-production-cdc6.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
```

Expected: Should return JSON response (not SSE event stream)

## Alternative: Fix Server Code (If You Have Access)

If you have access to the Graphiti MCP server source code, you can modify it to accept `application/json` alone:

1. Find the Accept header validation in the server code
2. Modify it to accept `application/json` without requiring `text/event-stream`
3. Redeploy

## Current Issue: File Not Found

**Error**: `Failed to spawn: graphiti_mcp_server.py - No such file or directory`

The script is likely in a subdirectory. Common locations:
- `mcp_server/graphiti_mcp_server.py`
- `graphiti/mcp_server/graphiti_mcp_server.py`
- Or needs to be run from a specific directory

## Current Configuration

- **URL**: `https://knowledge-graph-mcp-production-cdc6.up.railway.app/mcp`
- **Transport**: Currently SSE (needs to be HTTP)
- **Issue**: Requires both `application/json` and `text/event-stream` in Accept header
- **Current Error**: Script file not found - need correct path

## After Fix

Once fixed, the server should:
- ✅ Accept requests with only `Accept: application/json`
- ✅ Return standard JSON responses (not SSE event streams)
- ✅ Work with Cursor's MCP client without 406 errors
- ✅ Eliminate 409 conflicts from concurrent session issues

